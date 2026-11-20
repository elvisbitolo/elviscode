const GROUPS = {
  length: {
    m: 1,
    km: 1000,
    cm: 0.01,
    mm: 0.001,
    in: 0.0254,
    ft: 0.3048,
    yd: 0.9144,
    mi: 1609.344,
  },
  mass: {
    kg: 1,
    g: 0.001,
    mg: 0.000001,
    oz: 0.028349523125,
    lb: 0.45359237,
  },
  data: {
    bit: 0.125,
    byte: 1,
    kb: 1000,
    mb: 1000000,
    gb: 1000000000,
    tb: 1000000000000,
    kib: 1024,
    mib: 1048576,
    gib: 1073741824,
    tib: 1099511627776,
  },
  time: {
    s: 1,
    ms: 0.001,
    min: 60,
    h: 3600,
    d: 86400,
  },
};

const ALIASES = {
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  km: "km",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  cm: "cm",
  centimeter: "cm",
  centimeters: "cm",
  mm: "mm",
  millimeter: "mm",
  millimeters: "mm",
  in: "in",
  inch: "in",
  inches: "in",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  yd: "yd",
  yard: "yd",
  yards: "yd",
  mi: "mi",
  mile: "mi",
  miles: "mi",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  b: "bit",
  bit: "bit",
  bits: "bit",
  byte: "byte",
  bytes: "byte",
  kb: "kb",
  mb: "mb",
  gb: "gb",
  tb: "tb",
  kib: "kib",
  mib: "mib",
  gib: "gib",
  tib: "tib",
  s: "s",
  sec: "s",
  second: "s",
  seconds: "s",
  ms: "ms",
  millisecond: "ms",
  milliseconds: "ms",
  min: "min",
  minute: "min",
  minutes: "min",
  h: "h",
  hr: "h",
  hour: "h",
  hours: "h",
  d: "d",
  day: "d",
  days: "d",
};

const TEMPERATURE = ["c", "f", "k"];

function normalize(unit) {
  const raw = String(unit ?? "").trim().toLowerCase();
  return ALIASES[raw] || raw;
}

function groupFor(unit) {
  if (TEMPERATURE.includes(unit)) return "temperature";
  return Object.keys(GROUPS).find((name) => Object.hasOwn(GROUPS[name], unit)) || null;
}

function toBase(value, unit) {
  if (unit === "c") return value;
  if (unit === "f") return ((value - 32) * 5) / 9;
  if (unit === "k") return value - 273.15;
  return value * GROUPS[groupFor(unit)][unit];
}

function fromBase(value, unit) {
  if (unit === "c") return value;
  if (unit === "f") return (value * 9) / 5 + 32;
  if (unit === "k") return value + 273.15;
  return value / GROUPS[groupFor(unit)][unit];
}

export function convertUnits(inputValue, inputFrom, inputTo) {
  const value = Number(inputValue);
  if (!Number.isFinite(value)) throw new Error("Value must be a finite number.");

  const from = normalize(inputFrom);
  const to = normalize(inputTo);
  const fromGroup = groupFor(from);
  const toGroup = groupFor(to);

  if (!fromGroup || !toGroup) throw new Error("Unknown unit.");
  if (fromGroup !== toGroup) throw new Error(`Cannot convert ${from} to ${to}.`);

  const result = fromBase(toBase(value, from), to);
  if (!Number.isFinite(result)) throw new Error("Conversion result is not finite.");

  return { value, from, to, result };
}
