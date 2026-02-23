import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { IndoorTracker } from '../../src/services/indoorTracking';

import { IndoorMapViewer } from '../../src/components/IndoorMapViewer';
import { FloorSelector } from '../../src/components/FloorSelector';
import { LocationStatus } from '../../src/components/LocationStatus';
import { EmptyState } from '../../src/components/EmptyState';
import { ListSkeleton } from '../../src/components/SkeletonLoader';
import { useAppStore, Building, Floor, POI, Beacon } from '../../src/store/appStore';
import { buildingApi, floorApi, poiApi, beaconApi, navigationApi } from '../../src/services/api';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function MapScreen() {
  const router = useRouter();
  const {
    selectedBuilding,
    selectedFloor,
    selectedDestination,
    userLocation,
    locationMode,
    setSelectedBuilding,
    setSelectedFloor,
    setSelectedDestination,
    setUserLocation,
    setLocationMode,
    clearLocation,
  } = useAppStore();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [pois, setPois] = useState<POI[]>([]);
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDestinations, setShowDestinations] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [navigationRoute, setNavigationRoute] = useState<any>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mockIndex, setMockIndex] = useState(0);
  const [autoMove, setAutoMove] = useState(false);
  const [routeIndex, setRouteIndex] = useState(0);
  const AUTO_MOVE_DELAY_MS = 10000;
  const autoMoveDelayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [autoMoveRequested, setAutoMoveRequested] = useState(false);
  const [fixedRoute, setFixedRoute] = useState<Array<{ x: number; y: number; type: string }> | null>(null);
  const [fixedRouteKey, setFixedRouteKey] = useState<string | null>(null);
  const [stepMoveEnabled, setStepMoveEnabled] = useState(false);
  const stepSubRef = useRef<any>(null);
  const lastStepCountRef = useRef<number | null>(null);
  const stepRouteIndexRef = useRef<number>(0);
  const trackerRef = useRef<IndoorTracker | null>(null);
  const lastDeviationAtRef = useRef<number>(0);

  const floorBuildingId = useMemo(() => {
    if (!selectedFloor) return undefined;
    const anyFloor = selectedFloor as any;
    return anyFloor.building_id ?? anyFloor.buildingId;
  }, [selectedFloor]);

  const entryPoint = useMemo(() => {
    const poi = pois.find((p) => p.name?.toLowerCase() === 'entry gate')
      || pois.find((p) => (p.name || '').toLowerCase().includes('entry'));
    if (poi) {
      return { x: poi.x, y: poi.y };
    }
    return { x: 191, y: 89 };
  }, [pois]);

  const loadData = useCallback(async () => {
    try {
      const buildingsData = await buildingApi.getAll();
      setBuildings(buildingsData);

      // If no building selected and we have buildings, select the first one
      if (!selectedBuilding && buildingsData.length > 0) {
        setSelectedBuilding(buildingsData[0]);
      }
    } catch (error) {
      console.error('Error loading buildings:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedBuilding, setSelectedBuilding]);

  const loadFloors = useCallback(async () => {
    if (!selectedBuilding) {
      setFloors([]);
      return;
    }

    try {
      const floorsData = await floorApi.getAll(selectedBuilding.id);
      setFloors(floorsData);

      // If no floor selected and we have floors, select the first one
      if (!selectedFloor && floorsData.length > 0) {
        setSelectedFloor(floorsData[0]);
      } else if (selectedFloor && !floorsData.find(f => f.id === selectedFloor.id)) {
        // If selected floor no longer exists, select first floor
        setSelectedFloor(floorsData.length > 0 ? floorsData[0] : null);
      }
    } catch (error) {
      console.error('Error loading floors:', error);
    }
  }, [selectedBuilding, selectedFloor, setSelectedFloor]);

  const loadFloorData = useCallback(async () => {
    if (!selectedFloor) {
      setPois([]);
      setBeacons([]);
      return;
    }

    try {
      const [poisData, beaconData] = await Promise.all([
        poiApi.getAll(undefined, selectedFloor.id),
        beaconApi.getAll(undefined, selectedFloor.id),
      ]);
      setPois(poisData);
      setBeacons(beaconData);
    } catch (error) {
      console.error('Error loading floor data:', error);
    }
  }, [selectedFloor]);

  const computeRoute = useCallback(async () => {
    if (!userLocation || !selectedDestination || !selectedFloor) {
      return;
    }
    if (
      userLocation.floor_id !== selectedFloor.id ||
      selectedDestination.floor_id !== selectedFloor.id
    ) {
      return;
    }
    const routeKey = `${selectedFloor.id}|${selectedDestination.id}`;
    if (navigationRoute?.route && navigationRoute.__key === routeKey) {
      return;
    }
    try {
      const route = await navigationApi.computeRoute({
        buildingId: floorBuildingId,
        floorId: selectedFloor.id,
        startX: userLocation.x,
        startY: userLocation.y,
        destX: selectedDestination.x,
        destY: selectedDestination.y,
      });
      if (route?.route && route.route.length > 1) {
        setNavigationRoute({ ...route, __key: routeKey });
        setFixedRoute(route.route || []);
        setFixedRouteKey(routeKey);
      }
    } catch (error) {
      console.error('Error computing route:', error);
    }
  }, [userLocation, selectedDestination, selectedFloor, navigationRoute, floorBuildingId]);

  const effectiveRoute = useMemo(() => {
    const routeKey = selectedFloor && selectedDestination
      ? `${selectedFloor.id}|${selectedDestination.id}`
      : null;
    if (fixedRoute && fixedRouteKey && fixedRouteKey === routeKey && fixedRoute.length > 0) {
      return fixedRoute;
    }
    if (navigationRoute?.route && navigationRoute.route.length > 0) {
      return navigationRoute.route;
    }
    if (
      userLocation &&
      selectedDestination &&
      selectedFloor &&
      userLocation.floor_id === selectedFloor.id &&
      selectedDestination.floor_id === selectedFloor.id
    ) {
      return [
        { x: userLocation.x, y: userLocation.y, type: 'start' },
        { x: selectedDestination.x, y: selectedDestination.y, type: 'destination' },
      ];
    }
    return [];
  }, [fixedRoute, fixedRouteKey, navigationRoute, userLocation, selectedDestination, selectedFloor]);

  const autoRoute = useMemo(() => {
    if (!effectiveRoute || effectiveRoute.length === 0) return [];
    return effectiveRoute.map((p) => ({ x: p.x, y: p.y }));
  }, [effectiveRoute]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadFloors();
  }, [loadFloors]);

  useEffect(() => {
    loadFloorData();
  }, [loadFloorData]);

  useEffect(() => {
    if (!selectedFloor || userLocation || locationMode) return;
    // Default mock start: Entry Door for F1 map
    setMockIndex(0);
    setUserLocation({
      building_id: floorBuildingId || '',
      floor_id: selectedFloor.id,
      x: entryPoint.x,
      y: entryPoint.y,
      source: 'mock',
      timestamp: new Date(),
    });
    setLocationMode('mock');
  }, [selectedFloor, userLocation, locationMode, setUserLocation, setLocationMode, entryPoint, floorBuildingId]);

  useEffect(() => {
    computeRoute();
  }, [computeRoute]);


  useEffect(() => {
    if (!trackerRef.current) {
      trackerRef.current = new IndoorTracker();
      trackerRef.current.setPositionCallback((pos) => {
        if (!userLocation) return;
        setUserLocation({
          building_id: userLocation.building_id,
          floor_id: userLocation.floor_id,
          x: pos.x,
          y: pos.y,
          source: pos.source,
          timestamp: pos.timestamp,
        });
      });
      trackerRef.current.setDeviationCallback(() => {
        const now = Date.now();
        if (now - lastDeviationAtRef.current > 3000) {
          lastDeviationAtRef.current = now;
          computeRoute();
        }
      });
    }
  }, [computeRoute, setUserLocation, userLocation]);

  useEffect(() => {
    if (!trackerRef.current || !selectedFloor) return;
    trackerRef.current.setConfig({
      scanIntervalMs: 500,
      stepLengthM: 0.7,
      rssiThreshold: -90,
      kalmanProcessNoise: 0.01,
      kalmanMeasurementNoise: 2,
      deviationThresholdM: 2,
      snapToleranceM: 1.5,
      n: 2.5,
    });
    trackerRef.current.setBeacons(beacons);
    trackerRef.current.setRoute(autoRoute, selectedFloor.scale || 10);
    if (stepMoveEnabled) {
      trackerRef.current.startSensors();
    } else {
      trackerRef.current.stopSensors();
    }
  }, [beacons, autoRoute, selectedFloor, stepMoveEnabled]);

  useEffect(() => {
    return () => {
      if (autoMoveDelayTimerRef.current) {
        clearTimeout(autoMoveDelayTimerRef.current);
        autoMoveDelayTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!autoMoveRequested) return;
    if (autoMoveDelayTimerRef.current) {
      clearTimeout(autoMoveDelayTimerRef.current);
      autoMoveDelayTimerRef.current = null;
    }
    if (locationMode === 'mock' && effectiveRoute && effectiveRoute.length > 1) {
      autoMoveDelayTimerRef.current = setTimeout(() => {
        setAutoMove(true);
        setAutoMoveRequested(false);
      }, AUTO_MOVE_DELAY_MS);
    }
    return () => {
      if (autoMoveDelayTimerRef.current) {
        clearTimeout(autoMoveDelayTimerRef.current);
        autoMoveDelayTimerRef.current = null;
      }
    };
  }, [autoMoveRequested, locationMode, effectiveRoute]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    await loadFloors();
    await loadFloorData();
    setRefreshing(false);
  };

  const handleSelectDestination = (poi: POI) => {
    setSelectedDestination(poi);
    setShowDestinations(false);
    setDestinationQuery('');
    setNavigationRoute(null);
    setAutoMove(false);
    setFixedRoute(null);
    setFixedRouteKey(null);
    setAutoMoveRequested(true);
  };

  const handleClearDestination = () => {
    setSelectedDestination(null);
    setNavigationRoute(null);
    setFixedRoute(null);
    setFixedRouteKey(null);
    setAutoMove(false);
    setAutoMoveRequested(false);
  };

  const setMockLocation = (index: number) => {
    if (!selectedFloor) return;
    if (index === 0) {
      setMockIndex(0);
      setUserLocation({
        building_id: floorBuildingId || '',
        floor_id: selectedFloor.id,
        x: entryPoint.x,
        y: entryPoint.y,
        source: 'mock',
        timestamp: new Date(),
      });
      setLocationMode('mock');
      return;
    }
    if (beacons.length > 0) {
      const nextIndex = Math.max(1, Math.min(index, beacons.length));
      const beacon = beacons[nextIndex - 1];
      setMockIndex(nextIndex);
      setUserLocation({
        building_id: beacon.building_id || floorBuildingId || '',
        floor_id: beacon.floor_id,
        x: beacon.x,
        y: beacon.y,
        source: 'mock',
        timestamp: new Date(),
      });
      setLocationMode('mock');
      return;
    }
    // Fallback: center of the selected floor
    setMockIndex(0);
    setUserLocation({
      building_id: floorBuildingId || '',
      floor_id: selectedFloor.id,
      x: selectedFloor.width / 2,
      y: selectedFloor.height / 2,
      source: 'mock',
      timestamp: new Date(),
    });
    setLocationMode('mock');
  };

  const handleNextMock = () => {
    if (beacons.length === 0) {
      setMockLocation(0);
      return;
    }
    const next = (mockIndex + 1) % (beacons.length + 1);
    setMockLocation(next);
  };


  useEffect(() => {
    return () => {
      trackerRef.current?.stopSensors();
    };
  }, []);

  const displayedRoute = useMemo(() => {
    if (!effectiveRoute || effectiveRoute.length === 0) {
      return undefined;
    }
    return effectiveRoute;
  }, [effectiveRoute]);

  const handleNavigate = async () => {
    if (!userLocation || !selectedDestination || !selectedFloor) {
      Alert.alert('Error', 'Please set your location and destination');
      return;
    }
    if (userLocation.floor_id !== selectedFloor.id) {
      Alert.alert('Error', 'Your location is on a different floor');
      return;
    }

    try {
      setIsNavigating(true);
      const route = await navigationApi.computeRoute({
        buildingId: floorBuildingId,
        floorId: selectedFloor.id,
        startX: userLocation.x,
        startY: userLocation.y,
        destX: selectedDestination.x,
        destY: selectedDestination.y,
      });
      setNavigationRoute(route);
      if (selectedFloor && selectedDestination) {
        const routeKey = `${selectedFloor.id}|${selectedDestination.id}`;
        setFixedRoute(route.route || []);
        setFixedRouteKey(routeKey);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to compute route');
    } finally {
      setIsNavigating(false);
    }
  };

  const parseCoordinates = (input: string): { x: number; y: number } | null => {
    const match = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  };

  const filteredPois = destinationQuery.trim()
    ? pois.filter((poi) => {
        const q = destinationQuery.trim().toLowerCase();
        return (
          poi.name.toLowerCase().includes(q) ||
          (poi.category || '').toLowerCase().includes(q)
        );
      })
    : pois;

  const coordinateSuggestion = parseCoordinates(destinationQuery);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <ListSkeleton count={3} />
        </View>
      </SafeAreaView>
    );
  }

  if (buildings.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="business-outline"
          title="No Buildings"
          message="Add a building to start setting up indoor navigation."
          actionLabel="Add Building"
          onAction={() => router.push('/(tabs)/buildings')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4A90FF"
          />
        }
      >
        {/* Building Selector */}
        <View style={styles.buildingSelector}>
          <TouchableOpacity
            style={styles.buildingButton}
            onPress={() => {
              Alert.alert(
                'Select Building',
                undefined,
                buildings.map((b) => ({
                  text: b.name,
                  onPress: () => setSelectedBuilding(b),
                }))
              );
            }}
          >
            <Ionicons name="business" size={20} color="#4A90FF" />
            <Text style={styles.buildingName}>
              {selectedBuilding?.name || 'Select Building'}
            </Text>
            <Ionicons name="chevron-down" size={20} color="#888" />
          </TouchableOpacity>
        </View>

        {/* Floor Selector */}
        <FloorSelector
          floors={floors}
          selectedFloor={selectedFloor}
          onSelectFloor={setSelectedFloor}
        />

        {/* Location Status */}
        <LocationStatus
          userLocation={userLocation}
          locationMode={locationMode}
          buildingName={selectedBuilding?.name}
          floorName={selectedFloor?.name}
          onClear={clearLocation}
        />
        {selectedFloor && (
          <View style={styles.mockRow}>
            <TouchableOpacity
              style={styles.mockButton}
              onPress={() => setMockLocation(mockIndex)}
            >
              <Ionicons name="compass-outline" size={16} color="#fff" />
              <Text style={styles.mockButtonText}>
                {locationMode === 'mock' ? 'Reset Mock Location' : 'Use Mock Location'}
              </Text>
            </TouchableOpacity>
            {beacons.length > 1 && locationMode === 'mock' && (
              <TouchableOpacity style={styles.mockButtonSecondary} onPress={handleNextMock}>
                <Ionicons name="play-skip-forward" size={16} color="#4A90FF" />
                <Text style={styles.mockButtonSecondaryText}>Next Mock Point</Text>
              </TouchableOpacity>
            )}
            {locationMode === 'mock' && effectiveRoute.length > 1 && (
              <TouchableOpacity
                style={styles.mockButtonSecondary}
                onPress={() => setAutoMove((prev) => !prev)}
              >
                <Ionicons name={autoMove ? 'pause' : 'play'} size={16} color="#4A90FF" />
                <Text style={styles.mockButtonSecondaryText}>
                  {autoMove ? 'Stop Auto' : 'Auto Move'}
                </Text>
              </TouchableOpacity>
            )}
            {effectiveRoute.length > 1 && (
              <TouchableOpacity
                style={styles.mockButtonSecondary}
                onPress={() => setStepMoveEnabled((prev) => !prev)}
              >
                <Ionicons name={stepMoveEnabled ? 'pause' : 'walk'} size={16} color="#4A90FF" />
                <Text style={styles.mockButtonSecondaryText}>
                  {stepMoveEnabled ? 'Stop Steps' : 'Step Move'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Destination Selector */}
        {selectedFloor && (
          <View style={styles.destinationSection}>
            <TouchableOpacity
              style={styles.destinationButton}
              onPress={() => setShowDestinations(!showDestinations)}
            >
              <View style={styles.destinationLeft}>
                <Ionicons name="flag-outline" size={20} color="#FF6B6B" />
                <Text style={styles.destinationText}>
                  {selectedDestination
                    ? selectedDestination.name
                    : 'Select Destination'}
                </Text>
              </View>
              {selectedDestination ? (
                <TouchableOpacity onPress={handleClearDestination}>
                  <Ionicons name="close-circle" size={24} color="#FF6B6B" />
                </TouchableOpacity>
              ) : (
                <Ionicons
                  name={showDestinations ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#888"
                />
              )}
            </TouchableOpacity>

            <View style={styles.destinationSearchRow}>
              <Ionicons name="search-outline" size={18} color="#888" />
              <TextInput
                style={styles.destinationSearchInput}
                placeholder="Search destination or type x,y"
                placeholderTextColor="#666"
                value={destinationQuery}
                onChangeText={setDestinationQuery}
              />
              {!!destinationQuery && (
                <TouchableOpacity onPress={() => setDestinationQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#888" />
                </TouchableOpacity>
              )}
            </View>

            {selectedDestination && userLocation && userLocation.floor_id === selectedFloor.id && (
              <View style={styles.destinationActionRow}>
                <TouchableOpacity
                  style={styles.navigateButton}
                  onPress={handleNavigate}
                  disabled={isNavigating}
                >
                  <Ionicons name="navigate" size={18} color="#fff" />
                  <Text style={styles.navigateButtonText}>
                    {isNavigating ? 'Routing...' : 'Navigate'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {(showDestinations || destinationQuery.trim().length > 0) && (
              <View style={styles.destinationList}>
                {coordinateSuggestion && selectedFloor && (
                  <TouchableOpacity
                    style={styles.destinationItem}
                    onPress={() =>
                      handleSelectDestination({
                        id: 'temp-destination',
                        building_id: selectedFloor.building_id,
                        floor_id: selectedFloor.id,
                        name: `Custom (${coordinateSuggestion.x}, ${coordinateSuggestion.y})`,
                        category: 'destination',
                        x: coordinateSuggestion.x,
                        y: coordinateSuggestion.y,
                        created_at: new Date().toISOString(),
                      } as POI)
                    }
                  >
                    <Ionicons name="pin-outline" size={20} color="#FF6B6B" />
                    <View style={styles.destinationItemInfo}>
                      <Text style={styles.destinationItemName}>
                        Use coordinates ({coordinateSuggestion.x}, {coordinateSuggestion.y})
                      </Text>
                      <Text style={styles.destinationItemCategory}>Custom destination</Text>
                    </View>
                  </TouchableOpacity>
                )}

                {filteredPois.length === 0 && (
                  <View style={styles.emptyDestinationRow}>
                    <Text style={styles.emptyDestinationText}>No destinations found</Text>
                  </View>
                )}

                {filteredPois.map((poi) => (
                  <TouchableOpacity
                    key={poi.id}
                    style={styles.destinationItem}
                    onPress={() => handleSelectDestination(poi)}
                  >
                    <Ionicons
                      name={getCategoryIcon(poi.category)}
                      size={20}
                      color="#4ECDC4"
                    />
                    <View style={styles.destinationItemInfo}>
                      <Text style={styles.destinationItemName}>{poi.name}</Text>
                      <Text style={styles.destinationItemCategory}>
                        {poi.category}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Indoor Map */}
        {selectedFloor ? (
          <View style={styles.mapSection}>
            <IndoorMapViewer
              mapImage={
                selectedFloor.mapImageUrl
                  ? `${API_URL}${selectedFloor.mapImageUrl}`
                  : selectedFloor.map_image || selectedFloor.mapImage
              }
              mapWidth={selectedFloor.width}
              mapHeight={selectedFloor.height}
              userLocation={
                userLocation?.floor_id === selectedFloor.id ? userLocation : null
              }
              destination={
                selectedDestination?.floor_id === selectedFloor.id
                  ? selectedDestination
                  : null
              }
              route={displayedRoute}
              pois={pois}
              beacons={beacons}
              showMarkers={true}
              showRoutePoints={false}
            />
          </View>
        ) : (
          <EmptyState
            icon="map-outline"
            title="No Floors"
            message="Add floors to this building to view the indoor map."
            actionLabel="Manage Floors"
            onAction={() =>
              selectedBuilding &&
              router.push(`/building/${selectedBuilding.id}`)
            }
          />
        )}

        {/* Map Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Map Legend</Text>
          <View style={styles.legendItems}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#4A90FF' }]} />
              <Text style={styles.legendText}>Your Location</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#FF6B6B' }]} />
              <Text style={styles.legendText}>Destination</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#4ECDC4' }]} />
              <Text style={styles.legendText}>Points of Interest</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#A78BFA' }]} />
              <Text style={styles.legendText}>Beacons</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getCategoryIcon(category: string): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case 'room':
      return 'cube-outline';
    case 'elevator':
      return 'swap-vertical-outline';
    case 'stairs':
      return 'trending-up-outline';
    case 'restroom':
      return 'man-outline';
    case 'exit':
      return 'exit-outline';
    default:
      return 'location-outline';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  buildingSelector: {
    marginBottom: 12,
  },
  buildingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  buildingName: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  mapSection: {
    height: 400,
    marginBottom: 16,
  },
  destinationSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  destinationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  destinationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  destinationText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  mockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  mockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4A90FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mockButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  mockButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#4A90FF',
  },
  mockButtonSecondaryText: {
    color: '#4A90FF',
    fontSize: 12,
    fontWeight: '600',
  },
  destinationList: {
    borderTopWidth: 1,
    borderTopColor: '#252542',
  },
  destinationSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#252542',
  },
  destinationSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  destinationActionRow: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  navigateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A78BFA',
    borderRadius: 8,
    paddingVertical: 10,
    gap: 6,
  },
  navigateButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  destinationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#252542',
  },
  destinationItemInfo: {
    flex: 1,
  },
  destinationItemName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  destinationItemCategory: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  emptyDestinationRow: {
    padding: 12,
  },
  emptyDestinationText: {
    color: '#888',
    fontSize: 12,
  },
  legend: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
  },
  legendTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  legendItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    color: '#aaa',
    fontSize: 11,
  },
});
