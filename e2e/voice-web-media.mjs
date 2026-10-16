import assert from 'node:assert/strict';

/**
 * Executes the production Web endpoint in Chromium with Chromium's synthetic
 * microphone. This proves browser scheduling/PCM/credit/flush contracts only.
 * It does not prove cloud ASR, physical capture, speaker sound, AEC or hearing.
 */
export async function checkWebMedia(page, moduleUrl, step) {
  const boot = async ({ acknowledge = true, bufferUs = 200000, ageUs = 200000 } = {}) => {
    return page.evaluate(async ({ moduleUrl, acknowledge, bufferUs, ageUs }) => {
      await window.__nomiVoiceMedia?.endpoint.close();
      const { endpointFactory } = await import(moduleUrl);
      const format = { encoding: 'pcm', sample_format: 'signed16_le', sample_rate: 16000, channels: 1 };
      const spec = { format, timebase: 16000, min_frame_duration_us: 10000, max_frame_duration_us: 40000,
        max_frame_bytes: 1280, max_buffer_duration_us: bufferUs, max_frame_age_us: ageUs };
      const state = { frames: [], failures: [], cursors: [], acknowledge, endpoint: null, format, spec };
      window.__nomiVoiceMedia = state;
      state.endpoint = endpointFactory.create({
        capture: (metadata, payload) => {
          const pcm = new Int16Array(payload);
          state.frames.push({ ...metadata, bytes: payload.byteLength, nonzero: pcm.some(value => value !== 0) });
          if (state.acknowledge) state.endpoint.returnInputCredit?.(metadata.sequence, metadata.duration_us);
        },
        playback: cursor => state.cursors.push(cursor),
        unavailable: reason => state.failures.push(reason),
        level: () => {},
      });
      await state.endpoint.prepare('relay');
      const settings = await state.endpoint.configure({ capabilities: {}, input_spec: spec, output_spec: spec }, 10);
      await state.endpoint.startOutput();
      return { settings, supportsRelay: endpointFactory.transports.includes('relay'), secure: isSecureContext };
    }, { moduleUrl, acknowledge, bufferUs, ageUs });
  };
  const start = () => page.evaluate(() => window.__nomiVoiceMedia.endpoint.capture(true));
  const frames = () => page.evaluate(() => window.__nomiVoiceMedia.frames);
  const failures = () => page.evaluate(() => window.__nomiVoiceMedia.failures);
  const until = expression => page.waitForFunction(expression, undefined, { timeout: 5000 });
  const close = () => page.evaluate(() => window.__nomiVoiceMedia?.endpoint.close());
  try {
    await step('browser_pcm_with_matching_disposition', async () => {
      const device = await boot();
      assert.equal(device.supportsRelay, true);
      assert.equal(device.secure, true);
      assert.ok(device.settings.input_sample_rate >= 8000);
      assert.ok(device.settings.output_sample_rate >= 8000);
      await start();
      await until(() => window.__nomiVoiceMedia.frames.length >= 8 && window.__nomiVoiceMedia.frames.some(frame => frame.nonzero));
      await page.evaluate(() => window.__nomiVoiceMedia.endpoint.capture(false));
      const captured = await frames();
      assert.ok(captured.every(frame => frame.duration_us === 20000 && frame.bytes === 640));
      assert.ok(captured.some(frame => frame.nonzero), 'Chromium synthetic microphone did not supply PCM');
      assert.deepEqual(await failures(), []);
      return { source: 'Chromium synthetic microphone; production getUserMedia/AudioWorklet',
        frame_count: captured.length, input_rate: device.settings.input_sample_rate,
        output_rate: device.settings.output_sample_rate, cloud_disposition: false };
    });

    await step('pause_resume_never_reuses_input_sequence', async () => {
      const prior = await frames();
      const greatest = Math.max(...prior.map(frame => frame.sequence));
      await start();
      await until(() => window.__nomiVoiceMedia.frames.length >= 12);
      await page.evaluate(() => window.__nomiVoiceMedia.endpoint.capture(false));
      const captured = await frames();
      const newFrames = captured.slice(prior.length);
      assert.ok(newFrames.length > 0);
      assert.ok(newFrames.every(frame => frame.sequence > greatest));
      assert.equal(new Set(captured.map(frame => frame.sequence)).size, captured.length);
      return { before: greatest, resumed_first: newFrames[0].sequence };
    });

    await step('unacknowledged_input_is_bounded_before_message_port', async () => {
      await boot({ acknowledge: false, bufferUs: 60000, ageUs: 200000 });
      await start();
      await until(() => window.__nomiVoiceMedia.failures.length > 0);
      const captured = await frames();
      assert.ok(captured.length > 0 && captured.length <= 3);
      assert.ok(captured.reduce((sum, frame) => sum + frame.duration_us, 0) <= 60000);
      assert.ok((await failures()).includes('backlog'));
      return { server_dispositions: 0, frame_count: captured.length, maximum_duration_us: 60000 };
    });

    await step('wrong_disposition_cannot_expand_worklet_budget', async () => {
      await boot({ acknowledge: false, bufferUs: 60000, ageUs: 200000 });
      await start();
      await until(() => window.__nomiVoiceMedia.frames.length > 0);
      await page.evaluate(() => {
        const s = window.__nomiVoiceMedia, first = s.frames[0];
        try { s.endpoint.returnInputCredit?.(Number.MAX_SAFE_INTEGER, first.duration_us); } catch {}
        try { s.endpoint.returnInputCredit?.(first.sequence, first.duration_us + 1); } catch {}
      });
      await until(() => window.__nomiVoiceMedia.failures.length > 0);
      const captured = await frames();
      assert.ok(captured.length <= 3, 'AudioWorklet admitted more PCM than negotiated duration budget');
      assert.ok((await failures()).includes('backlog'));
      await page.evaluate(() => {
        const s = window.__nomiVoiceMedia;
        for (const frame of s.frames) {
          try { s.endpoint.returnInputCredit?.(frame.sequence, frame.duration_us); } catch {}
          try { s.endpoint.returnInputCredit?.(frame.sequence, frame.duration_us); } catch {}
        }
      });
      await page.waitForTimeout(120);
      assert.equal((await frames()).length, captured.length, 'late/duplicate ACK revived an expired capture owner');
      return { frame_count: captured.length, max_duration_us: 60000, expiry_latched: true };
    });

    await step('blocked_js_does_not_deliver_expired_capture_tail', async () => {
      await boot();
      await start();
      await until(() => window.__nomiVoiceMedia.frames.length >= 2);
      const before = (await frames()).length;
      await page.evaluate(() => {
        const end = performance.now() + 350;
        while (performance.now() < end) { /* Deliberately block JS; worklet must own its age budget. */ }
      });
      await until(() => window.__nomiVoiceMedia.failures.length > 0);
      const captured = await frames();
      assert.ok(captured.length - before <= 1, 'stale audio crossed into JS after its hardware admission expired');
      assert.ok((await failures()).includes('backlog'));
      return { js_block_ms: 350, admitted_tail_frames: captured.length - before,
        physical_track_stop_during_js_block: 'not proven; AudioWorklet cannot stop MediaStreamTrack' };
    });

    await step('output_generation_flush_and_honest_consumption', async () => {
      await boot();
      await page.evaluate(() => {
        const s = window.__nomiVoiceMedia;
        const pcm = new Int16Array(320).fill(1000);
        s.endpoint.play({ segment_id: 'before-flush', revision: 1, response_id: 'test', output_generation: 10 },
          { sequence: 1, timestamp: 0, duration_us: 20000, format: s.format, activation_epoch: 1,
            output_generation: 10, segment_id: 'before-flush' }, pcm.buffer);
      });
      await until(() => window.__nomiVoiceMedia.cursors.some(cursor => cursor.segment_id === 'before-flush'));
      await page.evaluate(() => {
        const s = window.__nomiVoiceMedia;
        s.endpoint.flush(11);
        const old = new Int16Array(320).fill(1000);
        s.endpoint.play({ segment_id: 'stale-after-flush', revision: 1, response_id: 'test', output_generation: 10 },
          { sequence: 2, timestamp: 320, duration_us: 20000, format: s.format, activation_epoch: 1,
            output_generation: 10, segment_id: 'stale-after-flush' }, old.buffer);
        const current = new Int16Array(320).fill(1000);
        s.endpoint.play({ segment_id: 'after-flush', revision: 1, response_id: 'test', output_generation: 11 },
          { sequence: 3, timestamp: 640, duration_us: 20000, format: s.format, activation_epoch: 1,
            output_generation: 11, segment_id: 'after-flush' }, current.buffer);
      });
      await until(() => window.__nomiVoiceMedia.cursors.some(cursor => cursor.segment_id === 'after-flush'));
      const cursors = await page.evaluate(() => window.__nomiVoiceMedia.cursors);
      assert.equal(cursors.some(cursor => cursor.segment_id === 'stale-after-flush'), false);
      assert.ok(cursors.every(cursor => ['estimated', 'unknown'].includes(cursor.precision)));
      assert.ok(cursors.every(cursor => cursor.consumed_us >= 0 && cursor.consumed_us <= 20000));
      assert.ok(cursors.filter(cursor => cursor.precision === 'unknown').every(cursor => cursor.consumed_us === 0));
      return { cursor_count: cursors.length, precisions: [...new Set(cursors.map(cursor => cursor.precision))],
        physical_playback_or_hearing: false };
    });

    await step('output_is_bounded_before_worklet_enqueue', async () => {
      await boot({ bufferUs: 60000, ageUs: 200000 });
      await page.evaluate(() => {
        const s = window.__nomiVoiceMedia;
        for (let sequence = 1; sequence <= 5; sequence++) {
          s.endpoint.play({ segment_id: 'output-budget-' + sequence, revision: 1,
            response_id: 'test', output_generation: 10 },
          { sequence, timestamp: (sequence - 1) * 320, duration_us: 20000, format: s.format,
            activation_epoch: 1, output_generation: 10, segment_id: 'output-budget-' + sequence },
          new Int16Array(320).fill(1000).buffer);
        }
      });
      assert.ok((await failures()).includes('backlog'));
      return { submitted_duration_us: 100000, maximum_duration_us: 60000, bounded_at_js_to_worklet: true };
    });

    await step('web_close_ends_tracks_and_pcm_delivery', async () => {
      await boot();
      await start();
      await until(() => window.__nomiVoiceMedia.frames.length >= 2);
      const tracks = await page.evaluate(() => {
        const s = window.__nomiVoiceMedia;
        s.tracks = s.endpoint.stream?.getTracks() ?? [];
        return s.tracks.length;
      });
      assert.ok(tracks > 0);
      await close();
      const count = (await frames()).length;
      await page.waitForTimeout(120);
      assert.equal((await frames()).length, count);
      assert.ok(await page.evaluate(() => window.__nomiVoiceMedia.tracks.every(track => track.readyState === 'ended')));
      return { ended_tracks: tracks, pcm_after_close: 0 };
    });
  } finally {
    await close().catch(() => {});
  }
}
