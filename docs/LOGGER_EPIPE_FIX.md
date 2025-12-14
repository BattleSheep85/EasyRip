# Logger EPIPE Error Fix - Technical Documentation

## Problem Statement

The logger was crashing the application with `EPIPE: broken pipe, write` errors when the MetadataWatcher called `logger.debug()`. The error occurred in `src/main/logger.js` at lines 147-168 (the write operations).

**Root Cause:**
- The logger used `fs.appendFile()` for synchronous writes
- No stream state management or error recovery
- Write errors would propagate up and crash the app
- No graceful degradation when file system is under stress

## Solution Overview

Implemented a robust, production-grade logging system with:

1. **Stream-based writes** - Using `createWriteStream` for better performance
2. **Error isolation** - EPIPE and other write errors never crash the app
3. **Automatic recovery** - Broken streams are automatically recovered after 5 seconds
4. **Write queuing** - Failed writes are queued (up to 1000 messages) for retry
5. **Graceful degradation** - Console logging always works, even if file writes fail
6. **Non-blocking operations** - Uses `setImmediate()` to prevent blocking callers

## Key Changes

### 1. Stream Management (lines 25-30)

Added new state tracking:
```javascript
this.writeStream = null;        // File write stream
this.streamBroken = false;      // Stream error state
this.isRecovering = false;      // Recovery in progress flag
this.writeQueue = [];           // Queued logs during recovery
this.processingQueue = false;   // Queue processing flag
```

### 2. Stream Initialization (lines 71-153)

**New method: `initializeWriteStream()`**
- Creates write stream with error handlers
- Listens for 'error' events (EPIPE, ENOSPC, etc.)
- Marks stream as broken on errors (non-fatal)
- Automatically triggers recovery

**New method: `scheduleStreamRecovery()`**
- Waits 5 seconds before recovery attempt
- Reinitializes the write stream
- Processes queued logs after recovery
- Prevents multiple concurrent recoveries

### 3. Safe Write Operations (lines 181-272)

**New method: `writeToStreamSafe(message)`**
- Promise-based write with error handling
- Handles backpressure (drain events)
- Catches both async and sync errors
- Never throws - always resolves or rejects gracefully

**New method: `processWriteQueue()`**
- Processes queued logs after recovery
- Stops if stream becomes broken again
- Re-queues failed messages

**Enhanced: `writeToFile(message)`**
- Checks stream state before writing
- Queues messages if stream is broken (max 1000)
- Triggers recovery automatically
- Never crashes on write failure

### 4. Error Isolation (lines 306-334)

**Enhanced: `log(level, category, message, data)`**
- Wrapped in try-catch for maximum safety
- Console logging always works (even if file write fails)
- File writes are non-blocking (`setImmediate`)
- Errors in write operations are silently caught

### 5. Graceful Shutdown (lines 412-441)

**New method: `cleanup()`**
- Flushes remaining queued logs
- Closes write stream gracefully
- 5-second timeout for forced close

**Process exit handler** (lines 448-456)
- Automatically closes stream on app exit
- Prevents resource leaks

## Error Handling Flow

```
MetadataWatcher.scanOnce()
    ↓
logger.debug("Scanning backup directory...")
    ↓
log() method (try-catch wrapper)
    ↓
setImmediate(() => writeToFile())
    ↓
Stream broken? → Queue message → Schedule recovery
    ↓
writeToStreamSafe()
    ↓
EPIPE error? → Mark stream broken → Queue for retry
    ↓
After 5s → Recovery attempt → Process queue
```

## Benefits

1. **No crashes** - EPIPE errors are caught and handled gracefully
2. **Data preservation** - Failed logs are queued for retry (up to 1000)
3. **Automatic recovery** - System self-heals from broken pipes
4. **Performance** - Stream-based writes are faster than `fs.appendFile`
5. **Backpressure handling** - Properly handles 'drain' events
6. **Memory safety** - Queue is capped at 1000 messages
7. **Console always works** - Debug output still visible even if files fail

## Testing

### Unit Test
`tests/logger-epipe.test.js` includes:
- EPIPE error handling test
- Message queuing verification
- Queue size limit test

### Manual Testing
1. Start app normally
2. MetadataWatcher calls logger.debug() repeatedly
3. Simulate file system stress (disk full, permissions, etc.)
4. Verify app continues running
5. Check console output still appears
6. Verify logs are queued and written after recovery

## Migration Notes

**Backward Compatible:**
- All existing logger methods work the same way
- No changes needed to calling code
- Same API surface (`logger.debug()`, `logger.info()`, etc.)

**New Features Available:**
- `logger.cleanup()` - Call before app shutdown for graceful cleanup
- Write stream auto-recovery
- Non-blocking file writes

## Performance Impact

- **Improved**: Stream writes are faster than `fs.appendFile()`
- **Improved**: Non-blocking writes don't delay calling code
- **Minimal overhead**: Error checking is O(1)
- **Memory bounded**: Queue capped at 1000 messages (~500KB typical)

## Security Considerations

- No user input in error messages (prevents log injection)
- Stream errors don't expose sensitive paths
- Recovery timeout prevents infinite retry loops
- Queue size limit prevents memory exhaustion attacks

## Future Enhancements (Optional)

1. Configurable queue size limit
2. Metrics on recovery events
3. Alternative storage (database, remote logging)
4. Structured logging format (JSON)
5. Log compression for old files

## Files Modified

- `src/main/logger.js` - Complete rewrite of write mechanism
- `tests/logger-epipe.test.js` - New test suite

## Verification Checklist

- [x] EPIPE errors don't crash app
- [x] Console logging always works
- [x] Failed writes are queued
- [x] Stream recovers automatically
- [x] Queue size is limited
- [x] Graceful shutdown works
- [x] No memory leaks
- [x] Backward compatible
- [x] Tests pass
- [x] MetadataWatcher works without crashes
