package com.wayfinding.indoor.service;

import com.wayfinding.indoor.dto.BeaconScanRequest;
import com.wayfinding.indoor.dto.PositionResponse;
import com.wayfinding.indoor.model.Beacon;
import com.wayfinding.indoor.model.Building;
import com.wayfinding.indoor.model.Floor;
import com.wayfinding.indoor.repository.BeaconRepository;
import com.wayfinding.indoor.repository.BuildingRepository;
import com.wayfinding.indoor.repository.FloorRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class PositioningService {

    private final BeaconRepository beaconRepository;
    private final FloorRepository floorRepository;
    private final BuildingRepository buildingRepository;

    /**
     * Compute user position from scanned beacons.
     * Uses nearest-beacon or weighted RSSI positioning.
     * NO trilateration, NO Kalman filters (per requirements).
     */
    public PositionResponse computePosition(BeaconScanRequest request) {
        if (request.getBeacons() == null || request.getBeacons().isEmpty()) {
            return PositionResponse.builder()
                    .valid(false)
                    .errorMessage("No beacons provided")
                    .build();
        }

        // Match scanned beacons to registered beacons in database
        List<MatchedBeacon> matchedBeacons = new ArrayList<>();
        
        for (BeaconScanRequest.ScannedBeacon scanned : request.getBeacons()) {
            Optional<Beacon> registered = beaconRepository.findByUuidAndMajorAndMinor(
                    scanned.getUuid().toUpperCase(),
                    scanned.getMajor(),
                    scanned.getMinor()
            );
            
            if (registered.isPresent()) {
                matchedBeacons.add(new MatchedBeacon(registered.get(), scanned.getRssi()));
            }
        }

        if (matchedBeacons.isEmpty()) {
            return PositionResponse.builder()
                    .valid(false)
                    .errorMessage("No registered beacons found")
                    .build();
        }

        // Group beacons by floor to determine which floor user is on
        Map<String, List<MatchedBeacon>> beaconsByFloor = matchedBeacons.stream()
                .collect(Collectors.groupingBy(mb -> mb.beacon.getFloorId()));

        // Find the floor with the strongest combined signal
        String bestFloorId = null;
        double bestFloorScore = Double.NEGATIVE_INFINITY;

        for (Map.Entry<String, List<MatchedBeacon>> entry : beaconsByFloor.entrySet()) {
            // Score = sum of RSSI values (less negative = stronger = better)
            double score = entry.getValue().stream()
                    .mapToDouble(mb -> mb.rssi)
                    .sum();
            if (score > bestFloorScore) {
                bestFloorScore = score;
                bestFloorId = entry.getKey();
            }
        }

        List<MatchedBeacon> floorBeacons = beaconsByFloor.get(bestFloorId);
        
        // Compute position using weighted average based on RSSI
        double[] position = computeWeightedPosition(floorBeacons);

        // Get floor and building info
        Optional<Floor> floorOpt = floorRepository.findById(bestFloorId);
        if (floorOpt.isEmpty()) {
            return PositionResponse.builder()
                    .valid(false)
                    .errorMessage("Floor not found")
                    .build();
        }

        Floor floor = floorOpt.get();
        Optional<Building> buildingOpt = buildingRepository.findById(floor.getBuildingId());

        return PositionResponse.builder()
                .valid(true)
                .buildingId(floor.getBuildingId())
                .buildingName(buildingOpt.map(Building::getName).orElse("Unknown"))
                .floorId(floor.getId())
                .floorName(floor.getName())
                .floorNumber(floor.getFloorNumber())
                .x(position[0])
                .y(position[1])
                .method(floorBeacons.size() == 1 ? "nearest" : "weighted")
                .beaconsUsed(floorBeacons.size())
                .build();
    }

    /**
     * Compute weighted position using RSSI-based weights.
     * Stronger signal (less negative RSSI) = higher weight.
     */
    private double[] computeWeightedPosition(List<MatchedBeacon> beacons) {
        if (beacons.size() == 1) {
            // Single beacon: just return its position
            Beacon b = beacons.get(0).beacon;
            return new double[]{b.getX(), b.getY()};
        }

        // Convert RSSI to weights
        // Weight = 10^(RSSI / 20) - this gives more weight to stronger signals
        double totalWeight = 0;
        double weightedX = 0;
        double weightedY = 0;

        for (MatchedBeacon mb : beacons) {
            // RSSI is typically -30 to -100 dBm
            // Convert to positive weight where stronger (less negative) = higher
            double weight = Math.pow(10, (100 + mb.rssi) / 40.0);
            
            weightedX += mb.beacon.getX() * weight;
            weightedY += mb.beacon.getY() * weight;
            totalWeight += weight;
        }

        if (totalWeight == 0) {
            // Fallback to simple average
            return new double[]{
                    beacons.stream().mapToDouble(mb -> mb.beacon.getX()).average().orElse(0),
                    beacons.stream().mapToDouble(mb -> mb.beacon.getY()).average().orElse(0)
            };
        }

        return new double[]{weightedX / totalWeight, weightedY / totalWeight};
    }

    /**
     * Helper class to hold a matched beacon with its RSSI
     */
    private static class MatchedBeacon {
        final Beacon beacon;
        final int rssi;

        MatchedBeacon(Beacon beacon, int rssi) {
            this.beacon = beacon;
            this.rssi = rssi;
        }
    }
}
