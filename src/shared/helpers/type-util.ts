/* eslint-disable @typescript-eslint/no-explicit-any */
export function transformToBoolean(value: any) {
  return value === true || value === 'true';
}

export function transformToDate(value: any) {
  return new Date(value);
}

export function transformToInt(value: any) {
  return parseInt(value) || 0;
}

export function transformToFloat(value: any) {
  return parseFloat(value) || 0;
}

export function isArray(arr: any): arr is any[] {
  return Array.isArray(arr);
}

export function isObject(obj: any): obj is Record<string, any> {
  return obj === Object(obj) && !isArray(obj) && typeof obj !== 'function';
}
