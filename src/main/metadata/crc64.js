/**
 * CRC64 Calculator
 * Port of pydvdid CRC64 algorithm to JavaScript
 * Used for DVD fingerprinting (Microsoft DVD ID standard)
 */

// CRC64 polynomial used by pydvdid (ECMA-182 variant)
const POLYNOMIAL = 0x92c64265d32139a4n;
const INITIAL_VALUE = 0xffffffffffffffffn;

// Pre-computed lookup table for faster calculation
let lookupTable = null;

/**
 * Build the CRC64 lookup table (256 entries)
 * @returns {BigInt[]} Lookup table
 */
function buildLookupTable() {
  const table = new Array(256);

  for (let i = 0; i < 256; i++) {
    let value = BigInt(i);
    for (let j = 0; j < 8; j++) {
      if (value & 1n) {
        value = (value >> 1n) ^ POLYNOMIAL;
      } else {
        value = value >> 1n;
      }
    }
    table[i] = value;
  }

  return table;
}

/**
 * Get or create the lookup table
 * @returns {BigInt[]} Lookup table
 */
function getLookupTable() {
  if (!lookupTable) {
    lookupTable = buildLookupTable();
  }
  return lookupTable;
}

/**
 * CRC64 Calculator class
 * Allows incremental updates for streaming data
 */
export class CRC64Calculator {
  constructor() {
    this.table = getLookupTable();
    this.crc = INITIAL_VALUE;
  }

  /**
   * Update CRC with additional data
   * @param {Buffer|Uint8Array} data - Data to add to CRC calculation
   * @returns {CRC64Calculator} this (for chaining)
   */
  update(data) {
    for (let i = 0; i < data.length; i++) {
      const byte = BigInt(data[i]);
      const index = Number((this.crc ^ byte) & 0xffn);
      this.crc = (this.crc >> 8n) ^ this.table[index];
    }
    return this;
  }

  /**
   * Get the final CRC64 value as a 16-character hex string
   * @returns {string} 16-character lowercase hex string
   */
  getHex() {
    // XOR with final value and convert to hex
    const finalCrc = this.crc ^ INITIAL_VALUE;
    return finalCrc.toString(16).padStart(16, '0');
  }

  /**
   * Get the final CRC64 value as BigInt
   * @returns {BigInt} CRC64 value
   */
  getValue() {
    return this.crc ^ INITIAL_VALUE;
  }

  /**
   * Reset calculator for reuse
   * @returns {CRC64Calculator} this (for chaining)
   */
  reset() {
    this.crc = INITIAL_VALUE;
    return this;
  }
}

/**
 * Create a new CRC64 calculator instance
 * @returns {CRC64Calculator} New calculator
 */
export function createCRC64() {
  return new CRC64Calculator();
}

/**
 * Calculate CRC64 of a buffer in one call
 * @param {Buffer|Uint8Array} data - Data to hash
 * @returns {string} 16-character hex string
 */
export function crc64Hex(data) {
  return createCRC64().update(data).getHex();
}

/**
 * Convert JavaScript Date to Windows FILETIME
 * FILETIME is 100-nanosecond intervals since January 1, 1601
 * @param {Date} date - JavaScript Date object
 * @returns {BigInt} Windows FILETIME value
 */
export function dateToFiletime(date) {
  // Difference between 1601-01-01 and 1970-01-01 in milliseconds
  const EPOCH_DIFF_MS = 11644473600000n;
  const ms = BigInt(date.getTime());
  // Convert to 100-nanosecond intervals
  return (ms + EPOCH_DIFF_MS) * 10000n;
}

/**
 * Convert FILETIME to 8-byte little-endian buffer
 * @param {BigInt} filetime - Windows FILETIME value
 * @returns {Buffer} 8-byte LE buffer
 */
export function filetimeToBuffer(filetime) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(filetime, 0);
  return buffer;
}

/**
 * Convert a number to 4-byte little-endian buffer (for file sizes)
 * @param {number} value - Number to convert
 * @returns {Buffer} 4-byte LE buffer
 */
export function uint32ToBuffer(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

export default {
  CRC64Calculator,
  createCRC64,
  crc64Hex,
  dateToFiletime,
  filetimeToBuffer,
  uint32ToBuffer
};
