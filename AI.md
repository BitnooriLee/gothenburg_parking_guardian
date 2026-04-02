# Project: Gothenburg Parking Guardian (GPG)

## 1. Project Goal
- Prevent expensive parking fines (1,300kr+) in Gothenburg.
- Save money by finding the cheapest parking zones (Taxa).
- Solve psychological stress of deciphering complex Swedish parking signs.

## 2. Target Users
- Residents and Expats in Gothenburg who own a car.
- People struggling with "Städdagar" (Street cleaning days).

## 3. Data Sources (Gothenburg City API v2.3)
- **Base URL**: `https://data.goteborg.se/ParkingService/v2.3/`
- **Endpoints**:
  - `PublicTollParkings`: City-owned paid parking (Check `Taxa`).
  - `PrivateTollParkings`: Privately owned paid parking (Check `Owner`).
  - `PublicTimeParkings`: Free parking with time limits (High risk of fines).
  - `CleaningZones`: Geographic polygons for street cleaning schedules.

## 4. Key Logic: Swedish Parking Rules Parser
- **Vardagar**: Monday - Friday. Usually 09-18.
- **Lördag (in brackets)**: Saturday. Usually (09-15).
- **Söndag/Röd dag (Red text)**: Sunday and Public Holidays. Usually free unless specified.
- **Boendeparkering**: Resident parking. Valid only within specific areas (e.g., Area 'M').

## 5. Feature Requirements (MVP)
1. **Cleaning Alert**: Map overlay of Cleaning Zones + Push notification 12 hours before cleaning starts.
2. **Taxa Comparison**: Highlight borders between different price zones (e.g., Taxa 7 vs Taxa 4).
3. **Countdown Timer**: Simple UI to start a timer for "PublicTimeParkings" with a 15-minute warning.

## 6. Current Progress & Context
- Initial setup phase.
- Need to implement the `Parser` that converts Swedish strings into Date objects.
- Need to set up Supabase tables with `geometry` support.

## 7. Useful Reference Links
- API Help: https://data.goteborg.se/ParkingService/v2.3/help
- Official P-Map: https://www.parkeringgoteborg.se/p-karta/


## 8. Language & Localization
- **Target Audience**: Local Swedes and International Expats in Gothenburg.
- **Supported Languages**: Swedish (Primary), English (Secondary).
- **Implementation**: 
  - All parking rules (from API) are originally in Swedish and should be presented clearly.
  - UI elements must be toggleable between Swedish and English.



# 9. Additional requirements

## 1. Context Retention (New Chat Guide)
새 채팅을 시작할 때: "이 프로젝트의 히스토리와 설계 원칙은 `.cursorrules`와 `ai.md`를 참고해"라고 명시할 것.

## 2. Core Logic Specification
- **Parser**: `Vardagar 09-18 (09-15)` 등 스웨덴어 주차 규칙의 완벽한 디지털화.
- **Geofencing**: 사용자의 GPS 좌표가 `CleaningZones` 폴리곤 내부에 있는지 실시간 판정.
- **Alert System**: 청소 시작 12시간 전, 1시간 전 푸시 알림.

## 3. UI Theme (Nordic Clean)
- Background: `#F9FAFB` (Very Light Gray)
- Primary (Safe): `#10B981` (Emerald Green)
- Warning (Alert): `#F59E0B` (Amber)
- Danger (Fine): `#EF4444` (Red)

## 4. Work History & Next Steps
- [ ] Step 1: Define TypeScript Interfaces (API Spec)
- [ ] Step 2: Implement Swedish Parking Rule Parser
- [ ] Step 3: Setup Supabase PostGIS Tables
- [ ] Step 4: Map Integration & Marker Logic