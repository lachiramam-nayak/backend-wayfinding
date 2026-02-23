import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  Platform,
  Animated,
  PanResponder,
  GestureResponderEvent,
  TouchableOpacity,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { POI, UserLocation, Beacon } from '../store/appStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface IndoorMapViewerProps {
  mapImage?: string;
  mapWidth: number;
  mapHeight: number;
  userLocation?: UserLocation | null;
  destination?: POI | null;
  route?: Array<{ x: number; y: number; type: string }>;
  pois?: POI[];
  beacons?: Beacon[];
  onPoiPress?: (poi: POI) => void;
  onMapPress?: (x: number, y: number) => void;
  showMarkers?: boolean;
  showDestinationMode?: boolean;
  showRoutePoints?: boolean;
}

export const IndoorMapViewer: React.FC<IndoorMapViewerProps> = ({
  mapImage,
  mapWidth,
  mapHeight,
  userLocation,
  destination,
  route,
  pois = [],
  beacons = [],
  onPoiPress,
  onMapPress,
  showMarkers = true,
  showDestinationMode = false,
  showRoutePoints = true,
}) => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [rotation, setRotation] = useState(0);

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;

  // Calculate aspect ratio to fit map in view
  const containerWidth = SCREEN_WIDTH - 32;
  const containerHeight = SCREEN_HEIGHT * 0.5;
  const aspectRatio = mapWidth / mapHeight;
  const containerAspectRatio = containerWidth / containerHeight;
  
  let displayWidth, displayHeight;
  if (aspectRatio > containerAspectRatio) {
    displayWidth = containerWidth;
    displayHeight = containerWidth / aspectRatio;
  } else {
    displayHeight = containerHeight;
    displayWidth = containerHeight * aspectRatio;
  }

  // Simple pan responder for drag
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (event, { dx, dy }) => {
        setTranslateX(translateX + dx);
        setTranslateY(translateY + dy);
      },
      onStartShouldSetPanResponderCapture: () => {
        // Allow taps to go through in destination mode
        return !showDestinationMode;
      },
    })
  ).current;

  // Convert map coordinates to display coordinates
  const toDisplayCoords = (x: number, y: number) => {
    return {
      x: (x / mapWidth) * displayWidth,
      y: (y / mapHeight) * displayHeight,
    };
  };

  // Convert display coordinates back to map coordinates
  const toMapCoords = (displayX: number, displayY: number) => {
    return {
      x: (displayX / displayWidth) * mapWidth,
      y: (displayY / displayHeight) * mapHeight,
    };
  };

  const handleMapTap = (event: GestureResponderEvent) => {
    if (!showDestinationMode || !onMapPress) return;
    const { locationX, locationY } = event.nativeEvent;
    const mapCoords = toMapCoords(locationX, locationY);
    onMapPress(Math.max(0, Math.min(mapCoords.x, mapWidth)), Math.max(0, Math.min(mapCoords.y, mapHeight)));
  };

  const rotateMap = (delta: number) => {
    setRotation((prev) => {
      const next = (prev + delta) % 360;
      return next < 0 ? next + 360 : next;
    });
  };

  const zoomBy = (delta: number) => {
    setScale((prev) => {
      const next = prev + delta;
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    });
  };

  const renderUserMarker = () => {
    if (!userLocation) return null;
    const coords = toDisplayCoords(userLocation.x, userLocation.y);
    return (
      <View
        style={[
          styles.marker,
          styles.userMarker,
          { left: coords.x - 12, top: coords.y - 12 },
        ]}
      >
        <View style={styles.userMarkerInner} />
        <View style={styles.userMarkerPulse} />
      </View>
    );
  };

  const renderDestinationMarker = () => {
    if (!destination) return null;
    const coords = toDisplayCoords(destination.x, destination.y);
    return (
      <View
        style={[
          styles.marker,
          styles.destinationMarker,
          { left: coords.x - 14, top: coords.y - 28 },
        ]}
      >
        <Ionicons name="location" size={28} color="#FF4D4D" />
      </View>
    );
  };

  const renderPOIMarkers = () => {
    if (!showMarkers) return null;
    return pois.map((poi) => {
      if (destination && poi.id === destination.id) return null;
      const coords = toDisplayCoords(poi.x, poi.y);
      return (
        <View
          key={poi.id}
          style={[
            styles.marker,
            styles.poiMarker,
            { left: coords.x - 8, top: coords.y - 8 },
          ]}
        />
      );
    });
  };

  const renderBeaconMarkers = () => {
    if (!showMarkers) return null;
    return beacons.map((beacon) => {
      const coords = toDisplayCoords(beacon.x, beacon.y);
      return (
        <View
          key={beacon.id}
          style={[
            styles.marker,
            styles.beaconMarker,
            { left: coords.x - 6, top: coords.y - 6 },
          ]}
        />
      );
    });
  };

  const renderRoute = () => {
    if (!route || route.length < 2) return null;
    
    const points = route
      .map((p) => {
        const coords = toDisplayCoords(p.x, p.y);
        return `${coords.x},${coords.y}`;
      })
      .join(' ');

    return (
      <View style={styles.routeContainer}>
        <Svg width={displayWidth} height={displayHeight} style={styles.routeSvg}>
          <Polyline
            points={points}
            fill="none"
            stroke="#0B3D91"
            strokeWidth={4}
            strokeOpacity={1}
          />
        </Svg>
        {showRoutePoints && route.map((p, i) => {
          const coords = toDisplayCoords(p.x, p.y);
          return (
            <View
              key={`route-point-${i}`}
              style={[
                styles.routePoint,
                {
                  left: coords.x - 3,
                  top: coords.y - 3,
                  backgroundColor: p.type === 'start'
                    ? '#22C55E'
                    : p.type === 'destination'
                    ? '#FF6B6B'
                    : '#4ECDC4',
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <View
        style={[
          styles.mapContainer,
          {
            transform: [
              { translateX },
              { translateY },
              { scale },
              { rotate: `${rotation}deg` },
            ],
          },
        ]}
        {...panResponder.panHandlers}
        onTouchEnd={handleMapTap}
      >
        {mapImage ? (
          <Image
            source={{ uri: mapImage }}
            style={[styles.mapImage, { width: displayWidth, height: displayHeight }]}
            resizeMode="contain"
            />
          ) : (
            <View style={[styles.placeholderMap, { width: displayWidth, height: displayHeight }]}>
              <View style={styles.gridOverlay}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <View key={`h-${i}`} style={[styles.gridLine, styles.gridLineHorizontal, { top: `${i * 10}%` }]} />
                ))}
                {Array.from({ length: 10 }).map((_, i) => (
                  <View key={`v-${i}`} style={[styles.gridLine, styles.gridLineVertical, { left: `${i * 10}%` }]} />
                ))}
              </View>
            </View>
          )}
        {renderRoute()}
        {renderBeaconMarkers()}
        {renderPOIMarkers()}
        {renderDestinationMarker()}
        {renderUserMarker()}
        {showDestinationMode && (
          <View style={styles.destinationModeOverlay}>
            <Text style={styles.destinationModeText}>Tap to select destination</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={() => rotateMap(-90)}>
          <Text style={styles.controlButtonText}>⟲</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={() => rotateMap(90)}>
          <Text style={styles.controlButtonText}>⟳</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={() => setRotation(0)}>
          <Text style={styles.controlButtonText}>Reset</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={() => zoomBy(0.25)}>
          <Text style={styles.controlButtonText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={() => zoomBy(-0.25)}>
          <Text style={styles.controlButtonText}>−</Text>
        </TouchableOpacity>
      </View>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
  },
  mapContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapImage: {
    borderRadius: 8,
  },
  placeholderMap: {
    backgroundColor: '#252542',
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  gridLineHorizontal: {
    left: 0,
    right: 0,
    height: 1,
  },
  gridLineVertical: {
    top: 0,
    bottom: 0,
    width: 1,
  },
  marker: {
    position: 'absolute',
    zIndex: 10,
  },
  userMarker: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4A90FF',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  userMarkerPulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(74, 144, 255, 0.3)',
  },
  destinationMarker: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poiMarker: {
    width: 16,
    height: 16,
    backgroundColor: '#4ECDC4',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  beaconMarker: {
    width: 12,
    height: 12,
    backgroundColor: '#A78BFA',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  routeContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  routeSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  routePoint: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#ffffff',
    zIndex: 20,
  },
  destinationModeOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(249, 115, 22, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  destinationModeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(26, 26, 46, 0.85)',
    padding: 6,
    borderRadius: 10,
  },
  controlButton: {
    backgroundColor: '#252542',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
