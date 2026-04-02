import type {
  PrivateTollParking,
  PublicTimeParking,
  PublicTollParking,
} from "../types/parking";
import type {
  ParkingDTO,
  PrivateTollParkingDTO,
  PublicTimeParkingDTO,
  PublicTollParkingDTO,
} from "../types/parking-dto";
import { parseSwedishRestriction } from "./parser";
import { wktToGeometry } from "./wkt";

export type ToParkingDTOInput =
  | { kind: "publicToll"; data: PublicTollParking }
  | { kind: "privateToll"; data: PrivateTollParking }
  | { kind: "publicTime"; data: PublicTimeParking };

function joinRestrictionParts(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
    .join("\n");
}

function mapBaseFields(
  data: Pick<
    PublicTollParking,
    "Id" | "Name" | "Owner" | "Distance" | "Lat" | "Long" | "WKT"
  >,
) {
  return {
    id: data.Id,
    name: data.Name,
    owner: data.Owner,
    distance: data.Distance ?? undefined,
    lat: data.Lat ?? undefined,
    lng: data.Long ?? undefined,
    wkt: data.WKT,
    geometry: wktToGeometry(data.WKT),
  };
}

export function toParkingDTO(input: { kind: "publicToll"; data: PublicTollParking }): PublicTollParkingDTO;
export function toParkingDTO(input: { kind: "privateToll"; data: PrivateTollParking }): PrivateTollParkingDTO;
export function toParkingDTO(input: { kind: "publicTime"; data: PublicTimeParking }): PublicTimeParkingDTO;
export function toParkingDTO(input: ToParkingDTOInput): ParkingDTO {
  if (input.kind === "publicToll") {
    const { data } = input;
    const raw = joinRestrictionParts(data.MaxParkingTime, data.MaxParkingTimeLimitation);
    const restrictions =
      raw.length > 0
        ? {
            raw,
            parsed: data.currentRestrictions?.parsed ?? parseSwedishRestriction(raw),
          }
        : data.currentRestrictions;

    return {
      kind: "publicToll",
      ...mapBaseFields(data),
      parkingSpaces: data.ParkingSpaces,
      freeSpaces: data.FreeSpaces,
      freeSpacesDate: data.FreeSpacesDate,
      phoneParkingCode: data.PhoneParkingCode,
      parkingCost: data.ParkingCost,
      parkingCharge: data.ParkingCharge,
      currentParkingCost: data.CurrentParkingCost,
      maxParkingTime: data.MaxParkingTime,
      maxParkingTimeLimitation: data.MaxParkingTimeLimitation,
      extraInfo: data.ExtraInfo,
      restrictions,
    };
  }

  if (input.kind === "privateToll") {
    const { data } = input;
    const raw = joinRestrictionParts(data.MaxParkingTime);
    const restrictions =
      raw.length > 0
        ? {
            raw,
            parsed: data.currentRestrictions?.parsed ?? parseSwedishRestriction(raw),
          }
        : data.currentRestrictions;

    return {
      kind: "privateToll",
      ...mapBaseFields(data),
      freeSpaces: data.FreeSpaces,
      freeSpacesDate: data.FreeSpacesDate,
      parkingSpaces: data.ParkingSpaces,
      phoneParkingCode: data.PhoneParkingCode,
      parkingCost: data.ParkingCost,
      currentParkingCost: data.CurrentParkingCost,
      maxParkingTime: data.MaxParkingTime,
      extraInfo: data.ExtraInfo,
      restrictions,
    };
  }

  const { data } = input;
  const raw = joinRestrictionParts(data.MaxParkingTime, data.MaxParkingTimeLimitation);
  const restrictions =
    raw.length > 0
      ? {
          raw,
          parsed: data.currentRestrictions?.parsed ?? parseSwedishRestriction(raw),
        }
      : data.currentRestrictions;

  return {
    kind: "publicTime",
    ...mapBaseFields(data),
    parkingSpaces: data.ParkingSpaces,
    maxParkingTime: data.MaxParkingTime,
    maxParkingTimeLimitation: data.MaxParkingTimeLimitation,
    extraInfo: data.ExtraInfo,
    restrictions,
  };
}
