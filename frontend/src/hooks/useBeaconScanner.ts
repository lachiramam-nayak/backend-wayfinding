/**
 * useBeaconScanner Hook
 * React hook for iBeacon scanning and positioning
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { useAppStore, UserLocation } from '../store/appStore';
import {
  beaconScanner,
  ScannedBeacon,
  BeaconScannerStatus,
  BeaconScannerOptions
} from '../services/beaconScanner';
import { IndoorTracker } from '../services/indoorTracking';
import {
  positioningApi,
  PositionResponse,
  navigationApi,
  NavigationResponse,
  NavigationRequest
} from '../services/api';


export interface UseBeaconScannerResult {
  // Scanner state
  isScanning: boolean;
  scannerStatus: BeaconScannerStatus;
  scannedBeacons: ScannedBeacon[];

  // Position state
  currentPosition: PositionResponse | null;
  isPositioning: boolean;
  positionError: string | null;

  // Navigation state
  navigationRoute: NavigationResponse | null;
  isNavigating: boolean;

  // Actions
  startScanning: (options?: BeaconScannerOptions) => Promise<boolean>;
  stopScanning: () => void;
  navigateTo: (destX: number, destY: number) => Promise<NavigationResponse | null>;
  clearNavigation: () => void;
}

export function useBeaconScanner(): UseBeaconScannerResult {
  // Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<BeaconScannerStatus>({
    isScanning: false,
    bluetoothEnabled: false,
    permissionsGranted: false,
  });
  const [scannedBeacons, setScannedBeacons] = useState<ScannedBeacon[]>([]);

  // Position state
  const [currentPosition, setCurrentPosition] = useState<PositionResponse | null>(null);
  const [isPositioning, setIsPositioning] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);

  // Navigation state
  const [navigationRoute, setNavigationRoute] = useState<NavigationResponse | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  // Refs to track latest values in callbacks
  const currentPositionRef = useRef<PositionResponse | null>(null);
  const rssiThresholdRef = useRef<number>(-88);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const setNavigationRouteStore = useAppStore((s) => s.setNavigationRoute);
  const trackerRef = useRef<IndoorTracker | null>(null);

  // Update ref when position changes
  useEffect(() => {
    currentPositionRef.current = currentPosition;
  }, [currentPosition]);

  /**
   * Handle incoming beacon data and compute position
   */
  const handleBeaconsFound = useCallback(async (beacons: ScannedBeacon[]) => {
    setScannedBeacons(beacons);

    if (beacons.length === 0) {
      return;
    }

    if (trackerRef.current) {
      trackerRef.current.ingestBeacons(beacons);
    }

    const usable = beacons.filter((b) => (b.avgRssi ?? b.rssi) >= (rssiThresholdRef.current ?? -88));
    if (usable.length === 0) {
      setPositionError(`No beacon with sufficient RSSI (threshold ${rssiThresholdRef.current ?? -88} dBm)`);
      return;
    }

    const top = usable
      .slice()
      .sort((a, b) => (b.avgRssi ?? b.rssi) - (a.avgRssi ?? a.rssi))
      .slice(0, 3);

    try {
      setIsPositioning(true);
      setPositionError(null);

      // Use only the strongest beacon for a single-beacon lookup
      const payload = top.map((b) => ({
        uuid: b.uuid,
        major: b.major,
        minor: b.minor,
        rssi: Math.round((b.avgRssi ?? b.rssi) as number),
      }));

      console.log('[Positioning] sending top beacons payload:', payload);
      const position = await positioningApi.computePosition(payload as any);

      if (position.valid) {
        setCurrentPosition(position);

        // Update global store user location so IndoorMapViewer and other components react
        try {
          const userLoc: UserLocation = {
            building_id: position.buildingId,
            floor_id: position.floorId,
            x: position.x,
            y: position.y,
            source: 'beacon',
            timestamp: new Date(),
          };
          setUserLocation(userLoc);
        } catch (e) {
          console.warn('[useBeaconScanner] Failed to set user location in store', e);
        }

        console.log(`[useBeaconScanner] Position (from strongest beacon): (${position.x.toFixed(1)}, ${position.y.toFixed(1)}) on ${position.floorName}`);
      } else {
        setPositionError(position.errorMessage || 'Position computation failed');
      }
    } catch (error) {
      console.error('[useBeaconScanner] Position error:', error);
      setPositionError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsPositioning(false);
    }
  }, []);

  useEffect(() => {
    if (!trackerRef.current) {
      trackerRef.current = new IndoorTracker();
    }
    return () => {
      trackerRef.current?.stopSensors();
    };
  }, []);

  /**
   * Handle scanner status changes
   */
  const handleStatusChange = useCallback((status: BeaconScannerStatus) => {
    setScannerStatus(status);
    setIsScanning(status.isScanning);
  }, []);

  /**
   * Start beacon scanning
   */
  const startScanning = useCallback(async (options?: BeaconScannerOptions): Promise<boolean> => {
    if (Platform.OS === 'web') {
      console.log('[useBeaconScanner] BLE not available on web');
      setScannerStatus({
        isScanning: false,
        bluetoothEnabled: false,
        permissionsGranted: false,
        error: 'BLE scanning requires a physical Android device',
      });
      return false;
    }

    // store the configured RSSI threshold so the handler uses the same value
    rssiThresholdRef.current = options?.rssiThreshold ?? -88;

    const success = await beaconScanner.startScanning(
      handleBeaconsFound,
      handleStatusChange,
      options
    );

    return success;
  }, [handleBeaconsFound, handleStatusChange]);

  /**
   * Stop beacon scanning
   */
  const stopScanning = useCallback(() => {
    beaconScanner.stopScanning();
    setIsScanning(false);
    setScannedBeacons([]);
  }, []);

  /**
   * Navigate to a destination
   */
  const navigateTo = useCallback(async (destX: number, destY: number): Promise<NavigationResponse | null> => {
    const position = currentPositionRef.current;

    if (!position || !position.valid) {
      console.error('[useBeaconScanner] Cannot navigate: no current position');
      return null;
    }

    try {
      setIsNavigating(true);

      const request: NavigationRequest = {
        buildingId: position.buildingId,
        floorId: position.floorId,
        startX: position.x,
        startY: position.y,
        destX,
        destY,
      };

      const route = await navigationApi.computeRoute(request);
      setNavigationRoute(route);
      // persist route to global store so map reads it
      try {
        setNavigationRouteStore(route);
      } catch (e) {
        console.warn('[useBeaconScanner] Failed to set navigation route in store', e);
      }

      console.log(`[useBeaconScanner] Navigation route: ${route.route.length} points, ${route.totalDistance.toFixed(1)} units`);

      return route;
    } catch (error) {
      console.error('[useBeaconScanner] Navigation error:', error);
      return null;
    } finally {
      setIsNavigating(false);
    }
  }, []);

  /**
   * Clear navigation route
   */
  const clearNavigation = useCallback(() => {
    setNavigationRoute(null);
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      beaconScanner.stopScanning();
    };
  }, []);

  return {
    // Scanner state
    isScanning,
    scannerStatus,
    scannedBeacons,

    // Position state
    currentPosition,
    isPositioning,
    positionError,

    // Navigation state
    navigationRoute,
    isNavigating,

    // Actions
    startScanning,
    stopScanning,
    navigateTo,
    clearNavigation,
  };
}
