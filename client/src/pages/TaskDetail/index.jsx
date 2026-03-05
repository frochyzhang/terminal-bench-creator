import React, { useEffect, useState, useRef } from 'react';
import {
  Typography, Tabs, Button, Space, Alert, Spin, Tag, Drawer,
  Form, Input, Select, message, Badge, Card, List, Descriptions
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined,
  RobotOutlined, BugOutlined, SendOutlined, ArrowLeftOutlined,
  SaveOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  StarOutlined, LoadingOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { getTask, getTaskFiles, saveTaskFile, lintTask, submitTask, startVerify, stopVerify, startPolish, stopPolish } from '../../api/tasks.js';
import { useSSE } from '../../hooks/useSSE.js';

const { Title, Text } = Typography;

const shellLang = StreamLanguage.define(shell);

const FILE_KEYS = [
  'instruction.md',
  'task.toml',
  'solution/solve.sh',
  'tests/test.sh',
  'environment/Dockerfile',
];

const FILE_LABEL = {
  'instruction.md': 'instruction.md',
  'task.toml': 'task.toml',
  'solution/solve.sh': 'solve.sh',
  'tests/test.sh': 'test.sh',
  'environment/Dockerfile': 'Dockerfile',
};

const FILE_EXT = {
  'instruction.md': [markdown()],
  'task.toml': [],
  'solution/solve.sh': [shellLang],
  'tests/test.sh': [shellLang],
  'environment/Dockerfile': [],
};

const STATUS_COLORS = { draft: 'default', ready: 'success', submitted: 'processing' };

function LintReport({ result }) {
  if (!result) return null;
  return (
    <Card size="small" title={`Lint Report: ${result.score} ${result.ready ? '✅ All Passed' : '❌ Issues Found'}`}>
      <List
        size="small"
        dataSource={result.checks}
        renderItem={(check) => (
          <List.Item>
            <Space>
              {check.pass
                ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
              <Text strong>[{check.id}]</Text>
              <Text>{check.name}</Text>
              {!check.pass && <Text type="danger"> — {check.message}</Text>}
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}

function SubmissionPanel({ taskId, onSubmitted }) {
  const [latestSubId, setLatestSubId] = useState(null);
  const [latestStatus, setLatestStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const sseUrl = latestSubId ? `/api/sse/submissions/${latestSubId}` : null;

  useSSE(sseUrl, {
    status: (data) => setLatestStatus(data),
    done: (data) => setLatestStatus(prev => ({ ...prev, ...data })),
  });

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const result = await submitTask(taskId);
      setLatestSubId(result.submission.id);
      setLatestStatus({ status: 'pending' });
      message.success('Task submitted to Terminal-Bench!');
      if (onSubmitted) onSubmitted();
    } catch (err) {
      message.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const statusColor =
    latestStatus?.status === 'AUTO_PASSED' || latestStatus?.status === 'APPROVED' ? 'success' :
    latestStatus?.status === 'AUTO_FAILED' || latestStatus?.status === 'REJECTED' ? 'error' :
    'processing';

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSubmit}
        loading={submitting}
        size="large"
      >
        Submit to Terminal-Bench
      </Button>

      {latestStatus && (
        <Card size="small" title="Latest Submission">
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Status">
              <Badge status={statusColor} text={latestStatus.status} />
            </Descriptions.Item>
            {latestStatus.task_points && (
              <Descriptions.Item label="Points">{latestStatus.task_points}</Descriptions.Item>
            )}
            {latestStatus.agent_fail_reason && (
              <Descriptions.Item label="Fail Reason">
                <Text type="danger">{latestStatus.agent_fail_reason}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}
    </Space>
  );
}

const VERIFY_MODELS = [
  { label: 'Claude Sonnet 4.5 (default)', value: 'Claude-Sonnet-4.5' },
  { label: 'Claude Opus 4.5', value: 'Claude-Opus-4.5' },
];

const LOG_COLORS = {
  error: '#ff4d4f',
  warn: '#faad14',
  info: '#58a6ff',
  trace: '#555',
};

function VerifyPanel({ taskId, onFilesFixed }) {
  const [verifyRunning, setVerifyRunning] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState(null);
  const [verifyLogs, setVerifyLogs] = useState([]);
  const [checkResult, setCheckResult] = useState(null);
  const [sseActive, setSseActive] = useState(false);
  const [maxRetries, setMaxRetries] = useState(10);
  const [model, setModel] = useState('Claude-Sonnet-4.5');
  const logsEndRef = useRef(null);

  const sseUrl = sseActive ? `/api/tasks/${taskId}/verify/stream` : null;

  useSSE(sseUrl, {
    started: (data) => {
      setVerifyRunning(true);
      setVerifyLogs([]);
      setCheckResult(null);
      setVerifyStatus({ attempt: 0, maxRetries: data.maxRetries, result: null });
    },
    attempt: (data) => {
      setVerifyStatus((prev) => ({ ...prev, attempt: data.attempt, maxRetries: data.maxRetries }));
    },
    log: (data) => {
      setVerifyLogs((prev) => [...prev, { level: data.level, text: data.message, ts: data.ts }]);
    },
    'harbor-log': (data) => {
      setVerifyLogs((prev) => [...prev, { level: 'trace', text: data.text, ts: new Date().toISOString() }]);
    },
    'check-result': (data) => {
      setCheckResult(data);
    },
    'ai-fixed': () => {
      if (onFilesFixed) onFilesFixed();
    },
    done: (data) => {
      setVerifyRunning(false);
      setVerifyStatus((prev) => ({ ...prev, result: data.result, attempts: data.attempts }));
    },
  });

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [verifyLogs]);

  async function handleStart() {
    try {
      setSseActive(true);
      setVerifyLogs([]);
      setCheckResult(null);
      setVerifyStatus(null);
      await startVerify(taskId, { maxRetries, model });
    } catch (err) {
      setSseActive(false);
      message.error('Failed to start verify: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleStop() {
    try {
      await stopVerify(taskId);
    } catch (err) {
      message.error('Stop failed: ' + err.message);
    }
  }

  const resultTag = verifyStatus?.result ? (
    <Tag color={
      verifyStatus.result === 'passed' ? 'success' :
      verifyStatus.result === 'failed' ? 'error' : 'warning'
    }>
      {verifyStatus.result.toUpperCase()}
    </Tag>
  ) : null;

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined />
          <span>Harbor Verify</span>
          {resultTag}
          {verifyRunning && verifyStatus && (
            <Tag color="processing">
              Attempt {verifyStatus.attempt}/{verifyStatus.maxRetries}
            </Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          <Select
            value={model}
            onChange={setModel}
            style={{ width: 240 }}
            size="small"
            options={VERIFY_MODELS}
          />
          <Select
            value={maxRetries}
            onChange={setMaxRetries}
            style={{ width: 110 }}
            size="small"
          >
            {[3, 5, 10, 15, 20].map((n) => (
              <Select.Option key={n} value={n}>{n} retries</Select.Option>
            ))}
          </Select>
          {verifyRunning ? (
            <Button danger size="small" onClick={handleStop}>Stop</Button>
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<SafetyCertificateOutlined />}
              onClick={handleStart}
            >
              Start Verify
            </Button>
          )}
        </Space>
      }
    >
      {checkResult && (
        <Alert
          type={checkResult.passed ? 'success' : 'error'}
          message={
            checkResult.passed
              ? '✅ All checks passed'
              : `❌ ${checkResult.issues?.length || 0} check(s) failed`
          }
          description={
            checkResult.issues?.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {checkResult.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            ) : null
          }
          style={{ marginBottom: 8 }}
        />
      )}

      {(verifyLogs.length > 0 || verifyRunning) && (
        <div style={{
          background: '#0d1117',
          borderRadius: 4,
          padding: '8px 12px',
          maxHeight: 320,
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: 12,
        }}>
          {verifyLogs.map((entry, i) => (
            <div key={i} style={{ color: LOG_COLORS[entry.level] || '#ccc', lineHeight: 1.7 }}>
              <span style={{ color: '#444', marginRight: 8, userSelect: 'none' }}>
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              {entry.text}
            </div>
          ))}
          {verifyRunning && <div style={{ color: '#555', marginTop: 4 }}>▋</div>}
          <div ref={logsEndRef} />
        </div>
      )}
    </Card>
  );
}

// ── PolishPanel ───────────────────────────────────────────────────────────────

const FIX_MODELS = [
  { label: 'Claude Opus 4.6 (recommended)', value: 'Claude-Opus-4.6' },
  { label: 'Claude Sonnet 4.6', value: 'Claude-Sonnet-4.6' },
  { label: 'Claude Opus 4.5', value: 'Claude-Opus-4.5' },
  { label: 'Claude Sonnet 4.5', value: 'Claude-Sonnet-4.5' },
];

function CheckIcon({ state }) {
  if (state === 'running') return <LoadingOutlined style={{ color: '#722ed1' }} />;
  if (state === 'pass')    return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  if (state === 'fail')    return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
  if (state === 'skip')    return <MinusCircleOutlined style={{ color: '#8c8c8c' }} />;
  return <MinusCircleOutlined style={{ color: '#3a3a3a' }} />;
}

function RoundRow({ r }) {
  const mkState = chk => chk?.skipped ? 'skip' : chk?.passed ? 'pass' : 'fail';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '4px 10px', borderRadius: 4, marginBottom: 4,
      background: r.allPassed ? '#0d2b1e' : '#2b0d0d',
      fontSize: 12, fontFamily: 'monospace', flexWrap: 'wrap',
    }}>
      <Text style={{ color: '#777', minWidth: 55 }}>Round {r.round}</Text>
      <Space size={10} wrap>
        <Space size={4}><CheckIcon state={mkState(r.format)} /><span style={{ color: '#aaa' }}>Format</span></Space>
        <Space size={4}><CheckIcon state={mkState(r.oracle)} /><span style={{ color: '#aaa' }}>Oracle</span></Space>
        <Space size={4}>
          <CheckIcon state={mkState(r.lint)} />
          <span style={{ color: '#aaa' }}>Lint</span>
          {!r.lint?.passed && !r.lint?.skipped && r.lint?.issues?.length > 0 &&
            <Text style={{ color: '#ff4d4f', fontSize: 11 }}>({r.lint.issues.length})</Text>}
        </Space>
        <Space size={4}>
          <CheckIcon state={mkState(r.instr)} />
          <span style={{ color: '#aaa' }}>InstrQ</span>
          {!r.instr?.passed && !r.instr?.skipped && r.instr?.issues?.length > 0 &&
            <Text style={{ color: '#ff4d4f', fontSize: 11 }}>({r.instr.issues.length})</Text>}
        </Space>
        <Space size={4}>
          <CheckIcon state={mkState(r.agent)} />
          <span style={{ color: '#aaa' }}>Agent</span>
        </Space>
        <Space size={4}>
          <CheckIcon state={mkState(r.post)} />
          <span style={{ color: '#aaa' }}>PostChk</span>
          {!r.post?.passed && !r.post?.skipped && r.post?.issues?.length > 0 &&
            <Text style={{ color: '#ff4d4f', fontSize: 11 }}>({r.post.issues.length})</Text>}
        </Space>
      </Space>
      <Tag color={r.allPassed ? 'success' : 'error'} style={{ marginLeft: 'auto' }}>
        {r.allPassed ? '全部通过' : '有问题'}
      </Tag>
    </div>
  );
}

const AGENT_ATTEMPT_OPTIONS = [
  { label: 'Skip (0)', value: 0 },
  { label: '1 attempt', value: 1 },
  { label: '4 attempts', value: 4 },
];

function PolishPanel({ taskId, onSubmitted }) {
  const [running, setRunning]       = useState(false);
  const [rounds, setRounds]         = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
  const [checks, setChecks]         = useState({ format: null, oracle: null, lint: null, instr: null, agent: null, post: null });
  const [submission, setSubmission] = useState(null);
  const [result, setResult]         = useState(null);
  const [logs, setLogs]             = useState([]);
  const [sseActive, setSseActive]   = useState(false);
  const [maxRounds, setMaxRounds]   = useState(5);
  const [agentAttempts, setAgentAttempts] = useState(4);
  const [fixModel, setFixModel]     = useState('Claude-Opus-4.5');
  const [autoSubmit, setAutoSubmit] = useState(true);
  const logsEndRef = useRef(null);

  const BLANK_CHECKS = { format: null, oracle: null, lint: null, instr: null, agent: null, post: null };

  const sseUrl = sseActive ? `/api/tasks/${taskId}/polish/stream` : null;

  useSSE(sseUrl, {
    status: (d) => {
      setRunning(d.running);
      setRounds(d.rounds || []);
      setLogs((d.logs || []).map(l => ({ level: l.level, text: l.message, ts: l.ts })));
    },
    'polish-start':   () => { setRunning(true); setRounds([]); setChecks({ ...BLANK_CHECKS }); setSubmission(null); setResult(null); setLogs([]); },
    'round-start':    (d) => { setCurrentRound(d.round); setChecks({ format: 'running', oracle: 'running', lint: 'running', instr: 'running', agent: 'running', post: 'running' }); },
    'format-running': () => setChecks(p => ({ ...p, format: 'running' })),
    'format-done':    (d) => setChecks(p => ({ ...p, format: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'oracle-running': () => setChecks(p => ({ ...p, oracle: 'running' })),
    'oracle-done':    (d) => setChecks(p => ({ ...p, oracle: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'lint-running':   () => setChecks(p => ({ ...p, lint: 'running' })),
    'lint-done':      (d) => setChecks(p => ({ ...p, lint: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'instr-running':  () => setChecks(p => ({ ...p, instr: 'running' })),
    'instr-done':     (d) => setChecks(p => ({ ...p, instr: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'agent-running':  () => setChecks(p => ({ ...p, agent: 'running' })),
    'agent-done':     (d) => setChecks(p => ({ ...p, agent: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'post-running':   () => setChecks(p => ({ ...p, post: 'running' })),
    'post-done':      (d) => setChecks(p => ({ ...p, post: d.skipped ? 'skip' : d.passed ? 'pass' : 'fail' })),
    'round-done':     (d) => setRounds(prev => [...prev, d]),
    'submitted':      (d) => { setSubmission(d); if (onSubmitted) onSubmitted(); },
    log:              (d) => setLogs(prev => [...prev, { level: d.level, text: d.message, ts: d.ts }]),
    'polish-done':    (d) => { setRunning(false); setResult(d.result); },
  });

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  async function handleStart() {
    try {
      setSseActive(true); setLogs([]); setRounds([]); setResult(null); setSubmission(null);
      await startPolish(taskId, { maxRounds, fixModel, autoSubmit, agentAttempts });
    } catch (err) {
      setSseActive(false);
      message.error('Failed to start polish: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleStop() {
    try { await stopPolish(taskId); } catch (err) { message.error('Stop failed: ' + err.message); }
  }

  const RESULT_COLOR = { submitted: 'success', passed: 'success', 'max-rounds': 'warning', stopped: 'default', error: 'error' };
  const anyCheckVisible = Object.values(checks).some(v => v !== null);

  return (
    <Card
      title={
        <Space>
          <StarOutlined style={{ color: '#faad14' }} />
          <span>Polish &amp; Submit</span>
          {result && <Tag color={RESULT_COLOR[result] || 'default'}>{result.toUpperCase()}</Tag>}
          {running && currentRound && (
            <Tag color="processing">Round {currentRound}/{maxRounds}</Tag>
          )}
        </Space>
      }
      extra={
        <Space wrap>
          <Select value={fixModel} onChange={setFixModel} style={{ width: 200 }} size="small" options={FIX_MODELS} />
          <Select
            value={agentAttempts}
            onChange={setAgentAttempts}
            style={{ width: 120 }}
            size="small"
            options={AGENT_ATTEMPT_OPTIONS}
          />
          <Select value={maxRounds} onChange={setMaxRounds} style={{ width: 110 }} size="small">
            {[3, 5, 8, 10].map(n => <Select.Option key={n} value={n}>{n} rounds</Select.Option>)}
          </Select>
          {running ? (
            <Button danger size="small" onClick={handleStop}>Stop</Button>
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<StarOutlined />}
              onClick={handleStart}
              style={{ background: '#d48806', borderColor: '#d48806' }}
            >
              Polish &amp; Submit
            </Button>
          )}
        </Space>
      }
    >
      {/* 六项并发检查实时状态 */}
      {(running || anyCheckVisible) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 12, padding: '8px 14px', background: '#111', borderRadius: 4, flexWrap: 'wrap' }}>
          {currentRound && <Text style={{ color: '#555', fontSize: 12, minWidth: 60 }}>Round {currentRound}</Text>}
          <Space size={6}><CheckIcon state={checks.format} /><Text style={{ fontSize: 12, color: '#aaa' }}>Format</Text></Space>
          <Space size={6}><CheckIcon state={checks.oracle} /><Text style={{ fontSize: 12, color: '#aaa' }}>Oracle</Text></Space>
          <Space size={6}><CheckIcon state={checks.lint}   /><Text style={{ fontSize: 12, color: '#aaa' }}>Lint (11)</Text></Space>
          <Space size={6}><CheckIcon state={checks.instr}  /><Text style={{ fontSize: 12, color: '#aaa' }}>InstrQ</Text></Space>
          <Space size={6}><CheckIcon state={checks.agent}  /><Text style={{ fontSize: 12, color: '#aaa' }}>Agent{agentAttempts > 0 ? `(${agentAttempts}x)` : ''}</Text></Space>
          <Space size={6}><CheckIcon state={checks.post}   /><Text style={{ fontSize: 12, color: '#aaa' }}>PostChk</Text></Space>
          {running && <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>并发执行中…</Text>}
        </div>
      )}

      {/* Round history */}
      {rounds.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {rounds.map((r, i) => <RoundRow key={i} r={r} />)}
        </div>
      )}

      {/* 提交成功 */}
      {submission && (
        <Alert
          type="success"
          message="✅ 本地全部通过 — 已提交 TB 平台！"
          description={`Local sub ID: ${submission.submissionId} · TB ID: ${submission.tbSubmissionId}`}
          style={{ marginBottom: 8 }}
        />
      )}
      {result === 'max-rounds' && (
        <Alert type="warning" message={`已达最大轮次 ${maxRounds} — 请查看日志后手动修复`} style={{ marginBottom: 8 }} />
      )}

      {/* Log panel */}
      {(logs.length > 0 || running) && (
        <div style={{
          background: '#0d1117', borderRadius: 4, padding: '8px 12px',
          maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12,
        }}>
          {logs.map((entry, i) => (
            <div key={i} style={{ color: LOG_COLORS[entry.level] || '#ccc', lineHeight: 1.7 }}>
              <span style={{ color: '#444', marginRight: 8, userSelect: 'none' }}>
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              {entry.text}
            </div>
          ))}
          {running && <div style={{ color: '#555', marginTop: 4 }}>▋</div>}
          <div ref={logsEndRef} />
        </div>
      )}
    </Card>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [files, setFiles] = useState({});
  const [activeFile, setActiveFile] = useState('instruction.md');
  const [loading, setLoading] = useState(true);
  const [lintResult, setLintResult] = useState(null);
  const [linting, setLinting] = useState(false);
  const [aiDrawer, setAiDrawer] = useState(false);
  const [aiForm] = Form.useForm();
  const [generateMode, setGenerateMode] = useState('single');
  const [generating, setGenerating] = useState(false);
  const [generateOutput, setGenerateOutput] = useState('');
  const saveTimers = useRef({});

  useEffect(() => {
    loadAll();
  }, [id]);

  async function loadAll() {
    setLoading(true);
    try {
      const [taskData, filesData] = await Promise.all([getTask(id), getTaskFiles(id)]);
      setTask(taskData);
      setFiles(filesData.files || {});
    } catch {
      message.error('Failed to load task');
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(filename, content) {
    setFiles(prev => ({ ...prev, [filename]: content }));
    clearTimeout(saveTimers.current[filename]);
    saveTimers.current[filename] = setTimeout(async () => {
      try {
        await saveTaskFile(id, filename, content);
      } catch {
        message.error(`Auto-save failed for ${filename}`);
      }
    }, 1000);
  }

  async function handleSaveNow() {
    try {
      await saveTaskFile(id, activeFile, files[activeFile]);
      message.success(`Saved ${activeFile}`);
    } catch {
      message.error(`Failed to save ${activeFile}`);
    }
  }

  async function handleLint() {
    setLinting(true);
    try {
      const result = await lintTask(id);
      setLintResult(result);
      if (result.ready) message.success('All lint checks passed!');
      else message.warning(`${result.total - result.passed} lint check(s) failed`);
    } catch {
      message.error('Lint failed');
    } finally {
      setLinting(false);
    }
  }

  async function handleGenerate(values) {
    setGenerating(true);
    setGenerateOutput('');

    const isAll = generateMode === 'all';
    const url = isAll
      ? `/api/tasks/${id}/generate/all`
      : `/api/tasks/${id}/generate`;

    const body = isAll
      ? { taskDescription: values.taskDescription }
      : { filename: values.filename, taskDescription: values.taskDescription };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.message) { message.error(`Generate error: ${data.message}`); return; }
            if (data.text) setGenerateOutput(prev => prev + data.text);
            if (data.content && data.filename) {
              setFiles(prev => ({ ...prev, [data.filename]: data.content }));
            }
            if (data.lint) setLintResult(data.lint);
          } catch { }
        }
      }

      message.success('AI generation complete');
      await loadAll();
      setAiDrawer(false);
    } catch (err) {
      message.error('AI generation failed: ' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!task) return <Alert type="error" message="Task not found" />;

  const tabItems = FILE_KEYS.map(filename => ({
    key: filename,
    label: FILE_LABEL[filename],
    children: (
      <CodeMirror
        value={files[filename] || ''}
        height="calc(100vh - 380px)"
        theme={oneDark}
        extensions={FILE_EXT[filename]}
        onChange={(value) => handleFileChange(filename, value)}
      />
    ),
  }));

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>Back</Button>
          <Title level={4} style={{ margin: 0 }}>{task.slug}</Title>
          <Badge status={STATUS_COLORS[task.status] || 'default'} text={task.status} />
          {task.difficulty && (
            <Tag color={{ Easy: 'green', Medium: 'orange', Hard: 'red' }[task.difficulty]}>
              {task.difficulty}
            </Tag>
          )}
        </Space>
        <Space>
          <Button icon={<SaveOutlined />} onClick={handleSaveNow}>Save</Button>
          <Button icon={<BugOutlined />} onClick={handleLint} loading={linting}>Lint</Button>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => {
            document.getElementById('verify-panel')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            Verify
          </Button>
          <Button
            icon={<StarOutlined />}
            style={{ color: '#d48806', borderColor: '#d48806' }}
            onClick={() => document.getElementById('polish-panel')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Polish
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setAiDrawer(true)} type="dashed">
            AI Generate
          </Button>
        </Space>
      </div>

      {/* File Editor */}
      <Card styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
        <Tabs
          activeKey={activeFile}
          onChange={setActiveFile}
          items={tabItems}
          tabBarStyle={{ padding: '0 16px', marginBottom: 0 }}
        />
      </Card>

      {/* Lint Result */}
      {lintResult && <div style={{ marginBottom: 16 }}><LintReport result={lintResult} /></div>}

      {/* Harbor Verify Panel */}
      <div id="verify-panel" style={{ marginBottom: 16 }}>
        <VerifyPanel taskId={id} onFilesFixed={loadAll} />
      </div>

      {/* Polish & Submit Panel */}
      <div id="polish-panel" style={{ marginBottom: 16 }}>
        <PolishPanel taskId={id} onSubmitted={loadAll} />
      </div>

      {/* Manual Submit Panel */}
      <Card title="Manual Submit to Terminal-Bench">
        <SubmissionPanel taskId={id} onSubmitted={loadAll} />
      </Card>

      {/* AI Generate Drawer */}
      <Drawer
        title="AI File Generation"
        open={aiDrawer}
        onClose={() => { setAiDrawer(false); setGenerateOutput(''); }}
        width={600}
        extra={
          <Button
            type="primary"
            onClick={() => aiForm.submit()}
            loading={generating}
            icon={<ThunderboltOutlined />}
          >
            Generate
          </Button>
        }
      >
        <Form form={aiForm} layout="vertical" onFinish={handleGenerate}>
          <Form.Item label="Mode">
            <Select value={generateMode} onChange={setGenerateMode}>
              <Select.Option value="single">Generate single file</Select.Option>
              <Select.Option value="all">Generate ALL files (in order)</Select.Option>
            </Select>
          </Form.Item>

          {generateMode === 'single' && (
            <Form.Item name="filename" label="File to Generate" rules={[{ required: true, message: 'Select a file' }]}>
              <Select placeholder="Select file">
                {FILE_KEYS.map(f => (
                  <Select.Option key={f} value={f}>{f}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item name="taskDescription" label="Task Description (for AI context)">
            <Input.TextArea
              rows={4}
              placeholder={task.description || 'Describe what the task should do...'}
            />
          </Form.Item>
        </Form>

        {(generating || generateOutput) && (
          <Card size="small" title={generating ? 'Generating...' : 'Generated'} style={{ marginTop: 16 }}>
            <pre style={{
              maxHeight: 300,
              overflow: 'auto',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              background: '#1e1e1e',
              color: '#d4d4d4',
              padding: 8,
              borderRadius: 4,
            }}>
              {generateOutput || 'Waiting for AI response...'}
            </pre>
          </Card>
        )}
      </Drawer>
    </div>
  );
}
