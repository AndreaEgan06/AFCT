import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/java-runner', () => ({
  default: class {
    execute = executeMock;
  },
}));

import { buildEvaluatorArgs, buildGradingConfig, runEvaluatorJar } from '@/lib/evaluator-runner';

const CONFIG = { timeoutMs: 5_000, maxMemoryMb: 256, analyzerLimit: 100 };

const run = (problem: { type: string | null; maxStates?: number | null; isDeterministic?: boolean | null }) =>
  runEvaluatorJar({
    answerFilePath: '/private/uploads/solutions/answer.jff',
    uploadedFilePath: '/private/uploads/submissions/upload.jff',
    config: CONFIG,
    problem,
  });

describe('buildEvaluatorArgs', () => {
  it('passes nothing extra for problem types without a state bound', () => {
    expect(buildEvaluatorArgs({ type: 'CFG' })).toEqual([]);
    expect(buildEvaluatorArgs({ type: null })).toEqual([]);
  });

  it('passes the state bound for PDA, and the determinism flag as well for FA', () => {
    expect(buildEvaluatorArgs({ type: 'PDA', maxStates: 8 })).toEqual(['8']);
    expect(buildEvaluatorArgs({ type: 'FA', maxStates: 5, isDeterministic: true })).toEqual([
      '5',
      'true',
    ]);
  });

  it('falls back to -1 states and non-deterministic when unset', () => {
    expect(buildEvaluatorArgs({ type: 'FA' })).toEqual(['-1', 'false']);
  });
});

describe('runEvaluatorJar', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('runs the jar with the configured limits and returns the parsed verdict', async () => {
    executeMock.mockResolvedValue({
      stdout: '  {"correct":true,"feedback":"Accepted"}  ',
      stderr: '',
    });

    const result = await run({ type: 'FA', maxStates: 5, isDeterministic: false });

    expect(executeMock).toHaveBeenCalledWith(
      [
        '--json',
        '/private/uploads/solutions/answer.jff',
        '/private/uploads/submissions/upload.jff',
        '5',
        'false',
      ],
      {
        timeout: 5_000,
        maxMemoryMb: 256,
        env: {
          CFGANALYZER_LIMIT: '100',
          TIMEOUT_SECONDS: '5',
          UPGRADED_FEEDBACK: 'true',
        },
      },
    );
    expect(result).toMatchObject({
      outcome: 'ok',
      correct: true,
      feedback: 'Accepted',
      evaluation: { correct: true, feedback: 'Accepted' },
      stdout: '{"correct":true,"feedback":"Accepted"}',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps stderr alongside a good verdict rather than treating it as a failure', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":false}', stderr: ' noisy warning ' });

    const result = await run({ type: 'CFG' });

    expect(result.outcome).toBe('ok');
    expect(result.stderr).toBe('noisy warning');
  });

  it('substitutes a readable sentence when the jar returns a Java Stream toString', async () => {
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"java.lang.Object$Stream@1a2b3c"}',
      stderr: '',
    });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'ok', feedback: 'Evaluation completed - correct: false' });
  });

  it('leaves correct undefined when the verdict is not a boolean', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":"yes"}', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'ok', feedback: 'Evaluation completed - correct: undefined' });
    expect(result.outcome === 'ok' && result.correct).toBeUndefined();
  });

  it('reports unparsable output, keeping what the jar printed', async () => {
    executeMock.mockResolvedValue({ stdout: 'Exception in thread "main"', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result.outcome).toBe('unparsable');
    expect(result.stdout).toBe('Exception in thread "main"');
  });

  it('treats empty output as unparsable', async () => {
    executeMock.mockResolvedValue({ stdout: '', stderr: '' });

    expect((await run({ type: 'CFG' })).outcome).toBe('unparsable');
  });

  it('reports JSON that is not an object separately from unparsable output', async () => {
    executeMock.mockResolvedValue({ stdout: 'null', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'invalid-json', evaluation: null });
  });

  it('returns an error outcome instead of throwing when the jar cannot run', async () => {
    executeMock.mockRejectedValue(new Error('Evaluation timed out'));

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'error', error: 'Evaluation timed out', stdout: '', stderr: '' });
  });

  it('gives the jar at least one second of early-stopping budget', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true}', stderr: '' });

    await runEvaluatorJar({
      answerFilePath: 'a',
      uploadedFilePath: 'b',
      config: { timeoutMs: 200, maxMemoryMb: 256, analyzerLimit: 10 },
      problem: { type: 'CFG' },
    });

    expect(executeMock.mock.calls[0][1].env.TIMEOUT_SECONDS).toBe('1');
  });
});

const SPEC = { alphabet: ['a', 'b'], condition: { kind: 'endWt', w: 'ab' } };
const BINARY = { version: 1, kind: 'binary' };

describe('buildGradingConfig', () => {
  it('is null when there is neither a description nor a rubric, so the jar runs as it always did', () => {
    expect(buildGradingConfig({ type: 'FA' })).toBeNull();
    expect(buildGradingConfig({ type: 'FA', moselSpec: null, rubricDefinition: null })).toBeNull();
  });

  it('sends the description for an FA problem only', () => {
    expect(buildGradingConfig({ type: 'FA', moselSpec: SPEC })).toEqual({ mosel: SPEC });
    expect(buildGradingConfig({ type: 'CFG', moselSpec: SPEC })).toBeNull();
  });

  // RUBRIC: rubric pass-through to the jar.
  it('sends the rubric for any problem type', () => {
    expect(buildGradingConfig({ type: 'CFG', rubricDefinition: BINARY })).toEqual({ rubric: BINARY });
    expect(buildGradingConfig({ type: 'FA', moselSpec: SPEC, rubricDefinition: BINARY })).toEqual({
      mosel: SPEC,
      rubric: BINARY,
    });
  });
});

describe('runEvaluatorJar with a grading config', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('passes the config on stdin and reads the score back', async () => {
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"No","score":0.0,"analysis":{"counts":{}}}',
      stderr: '',
    });

    const grading = { mosel: SPEC, rubric: BINARY } as Parameters<typeof runEvaluatorJar>[0]['grading'];
    const result = await runEvaluatorJar({
      answerFilePath: 'a.jff',
      uploadedFilePath: 'b.jff',
      config: CONFIG,
      problem: { type: 'FA', maxStates: -1, isDeterministic: false },
      grading,
    });

    const [args, options] = executeMock.mock.calls[0];
    expect(args).toEqual(['--json', '--grading-config', '-', 'a.jff', 'b.jff', '-1', 'false']);
    expect(JSON.parse(options.input)).toEqual({ mosel: SPEC, rubric: BINARY });
    expect(result).toMatchObject({ outcome: 'ok', correct: false, score: 0 });
  });

  it('ignores a score that is not a number from 0 to 1', async () => {
    for (const score of ['1', 1.5, -0.1, null]) {
      executeMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ correct: true, score }),
        stderr: '',
      });
      const result = await run({ type: 'FA' });
      expect(result.outcome === 'ok' && result.score).toBeUndefined();
    }
  });

  it('marks against the description when there is no answer file', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"Correct!"}', stderr: '' });

    const grading = { mosel: SPEC } as Parameters<typeof runEvaluatorJar>[0]['grading'];
    const result = await runEvaluatorJar({
      answerFilePath: null,
      uploadedFilePath: 'b.jff',
      config: CONFIG,
      problem: { type: 'FA', maxStates: -1, isDeterministic: false },
      grading,
    });

    const [args, options] = executeMock.mock.calls[0];
    expect(args).toEqual([
      '--json',
      '--grading-config',
      '-',
      '--answer-from-mosel',
      'b.jff',
      '-1',
      'false',
    ]);
    expect(JSON.parse(options.input)).toEqual({ mosel: SPEC });
    expect(result).toMatchObject({ outcome: 'ok', correct: true });
  });

  it('does not run without an answer file or a description', async () => {
    const result = await runEvaluatorJar({
      answerFilePath: null,
      uploadedFilePath: 'b.jff',
      config: CONFIG,
      problem: { type: 'FA', maxStates: -1, isDeterministic: false },
      grading: null,
    });

    expect(executeMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'error' });
  });

  it('sends no stdin and no flag without a config', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true}', stderr: '' });

    await run({ type: 'FA' });

    expect(executeMock.mock.calls[0][0]).not.toContain('--grading-config');
    expect(executeMock.mock.calls[0][1]).not.toHaveProperty('input');
  });
});
