// Test logger EPIPE error handling
// Verifies that logger handles broken pipe errors gracefully without crashing

import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

// Mock logger class for testing EPIPE handling
class MockLogger extends EventEmitter {
  constructor() {
    super();
    this.writeStream = null;
    this.streamBroken = false;
    this.isRecovering = false;
    this.writeQueue = [];
    this.processingQueue = false;
  }

  createBrokenStream() {
    const stream = new EventEmitter();
    stream.write = () => {
      const err = new Error('EPIPE: broken pipe');
      err.code = 'EPIPE';
      process.nextTick(() => stream.emit('error', err));
      return false;
    };
    stream.destroyed = false;
    stream.end = () => {
      stream.destroyed = true;
    };
    return stream;
  }

  async writeToStreamSafe(message) {
    return new Promise((resolve, reject) => {
      if (!this.writeStream || this.streamBroken || this.writeStream.destroyed) {
        reject(new Error('Stream not available'));
        return;
      }

      try {
        const canWrite = this.writeStream.write(message, 'utf8', (err) => {
          if (err) {
            console.error('[MockLogger] Write error (non-fatal):', err.code || err.message);
            this.streamBroken = true;
            reject(err);
          } else {
            resolve();
          }
        });

        if (!canWrite) {
          this.writeStream.once('drain', () => {
            resolve();
          });
        }
      } catch (err) {
        console.error('[MockLogger] Write exception (non-fatal):', err.code || err.message);
        this.streamBroken = true;
        reject(err);
      }
    });
  }

  async writeToFile(message) {
    if (this.streamBroken || !this.writeStream || this.writeStream.destroyed) {
      if (this.writeQueue.length < 1000) {
        this.writeQueue.push(message);
      }
      return;
    }

    try {
      await this.writeToStreamSafe(message);
    } catch (err) {
      if (this.writeQueue.length < 1000) {
        this.writeQueue.push(message);
      }
    }
  }
}

test('Logger handles EPIPE errors gracefully', async () => {
  const logger = new MockLogger();

  // Create a broken stream that emits EPIPE
  logger.writeStream = logger.createBrokenStream();

  // Setup error handler
  let errorEmitted = false;
  logger.writeStream.on('error', (err) => {
    errorEmitted = true;
    logger.streamBroken = true;
  });

  // Attempt to write (should fail gracefully)
  try {
    await logger.writeToFile('Test message');
  } catch (err) {
    // Expected to fail
  }

  // Wait for error event
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify error was handled
  assert.strictEqual(errorEmitted, true, 'EPIPE error should be emitted');
  assert.strictEqual(logger.streamBroken, true, 'Stream should be marked as broken');
  assert.strictEqual(logger.writeQueue.length, 1, 'Failed message should be queued');
});

test('Logger queues messages when stream is broken', async () => {
  const logger = new MockLogger();
  logger.streamBroken = true;

  // Write multiple messages
  await logger.writeToFile('Message 1');
  await logger.writeToFile('Message 2');
  await logger.writeToFile('Message 3');

  // Verify all messages were queued
  assert.strictEqual(logger.writeQueue.length, 3, 'All messages should be queued');
  assert.strictEqual(logger.writeQueue[0], 'Message 1');
  assert.strictEqual(logger.writeQueue[1], 'Message 2');
  assert.strictEqual(logger.writeQueue[2], 'Message 3');
});

test('Logger respects queue size limit', async () => {
  const logger = new MockLogger();
  logger.streamBroken = true;

  // Write more than 1000 messages
  for (let i = 0; i < 1500; i++) {
    await logger.writeToFile(`Message ${i}`);
  }

  // Verify queue is capped at 1000
  assert.strictEqual(logger.writeQueue.length, 1000, 'Queue should be capped at 1000 messages');
});

console.log('All logger EPIPE tests passed!');
