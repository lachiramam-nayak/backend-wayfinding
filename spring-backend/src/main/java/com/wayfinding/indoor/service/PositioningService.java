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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class PositioningService {

    private final BeaconRepository beaconRepository;
    private final FloorRepository floorRepository;
    private final BuildingRepository buildingRepository;

    /**
     * Compute user position from scanned beacons using iBeacon UUID+Major+Minor matching.
     * Picks the strongest valid beacon (highest RSSI) and returns its coordinates.
     * This method ignores MAC addresses and matches only on UUID/Major/Minor.
     */
    public PositionResponse computePosition(BeaconScanRequest request) {
        if (request.getBeacons() == null || request.getBeacons().isEmpty()) {
            return PositionResponse.builder()
                    .valid(false)
                    .errorMessage("No beacons provided")
                    .build();
        }

        // Match scanned beacons to registered beacons in database (UUID+Major+Minor only)
        List<MatchedBeacon> matchedBeacons = new ArrayList<>();
        
        for (BeaconScanRequest.ScannedBeacon scanned : request.getBeacons()) {
            // Filter out weak signals (backend side safety): ignore RSSI below -75 dBm
            if (scanned.getRssi() < -75) {
                continue;
            }

            // Match by UUID+Major+Minor (preferred). Do NOT use MAC addresses.
            Optional<Beacon> registered = Optional.empty();
            if (scanned.getUuid() != null && !scanned.getUuid().trim().isEmpty()) {
                String uuid = scanned.getUuid().trim();
                Integer major = scanned.getMajor();
                Integer minor = scanned.getMinor();

                if (major != null && minor != null) {
                    String upper = uuid.toUpperCase();
                    String lower = uuid.toLowerCase();
                    registered = beaconRepository.findByUuidAndMajorAndMinor(upper, major, minor);
                    if (registered.isEmpty() && !lower.equals(upper)) {
                        registered = beaconRepository.findByUuidAndMajorAndMinor(lower, major, minor);
                    }
                }
            }

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

        // Pick strongest RSSI (closest to 0)
        MatchedBeacon best = matchedBeacons.stream()
                .max(Comparator.comparingInt(mb -> mb.rssi))
                .orElse(null);
        if (best == null) {
            return PositionResponse.builder()
                    .valid(false)
                    .errorMessage("No registered beacons found")
                    .build();
        }

        double[] position = new double[]{best.beacon.getX(), best.beacon.getY()};
        String method = "ibeacon";

        // Get floor and building info
        Optional<Floor> floorOpt = floorRepository.findById(best.beacon.getFloorId());
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
                .method(method)
                .beaconsUsed(1)
                .build();
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
