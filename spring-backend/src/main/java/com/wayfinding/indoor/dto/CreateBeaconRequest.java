package com.wayfinding.indoor.dto;

import lombok.Data;

@Data
public class CreateBeaconRequest {
    private String buildingId;
    private String floorId;
    private String uuid;
    private int major;
    private int minor;
    private double x;
    private double y;
    private String label;
    private Double txPower;
}
