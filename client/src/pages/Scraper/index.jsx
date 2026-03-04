import React, { useEffect, useRef, useState } from 'react';
import {
  Row, Col, Card, Form, Input, InputNumber, Select, Switch, Button,
  Space, Typography, Tag, Badge, Table, Divider, Tooltip, message,
  Collapse, Statistic, Progress,
} from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, StopOutlined,
  EyeOutlined, SearchOutlined, RobotOutlined, LinkOutlined,
  ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { startScrape, stopScrape, pauseScrape, resumeScrape, previewSO, getScrapeStatus } from '../../api/scraper.js';

import { useSSE } from '../../hooks/useSSE.js';

const { Title, Text, Paragraph } = Typography;

// ── Log colours ───────────────────────────────────────────────────────────────
const LOG_COLORS = { info: '#60a5fa', warn: '#fbbf24', error: '#f87171' };

// ── Tag Presets (12 TB domains → SO tags) ─────────────────────────────────────
const TAG_PRESETS = [
  { label: '🐧 System/Infra', tags: ['bash', 'linux', 'shell', 'awk', 'sed', 'grep', 'ssh', 'cron'] },
  { label: '🐍 Python', tags: ['python', 'python-3.x', 'subprocess', 'argparse', 'asyncio'] },
  { label: '🦀 Go / Rust', tags: ['go', 'rust', 'cargo'] },
  { label: '⚙️ C/C++ Build', tags: ['c', 'c++', 'gcc', 'cmake', 'makefile', 'compilation'] },
  { label: '📊 Data Eng.', tags: ['pandas', 'csv', 'json', 'sql', 'parsing', 'awk'] },
  { label: '🔐 Security', tags: ['openssl', 'cryptography', 'gpg', 'certificates', 'ssh'] },
  { label: '🧠 ML/NumPy', tags: ['numpy', 'scipy', 'machine-learning', 'pytorch', 'scikit-learn'] },
  { label: '🎬 Multimedia', tags: ['ffmpeg', 'imagemagick', 'video', 'image-processing'] },
  { label: '🐛 Debugging', tags: ['gdb', 'debugging', 'valgrind', 'strace', 'memory-leaks'] },
  { label: '🌐 Networking', tags: ['networking', 'sockets', 'tcp', 'http', 'curl'] },
];

const ALL_TAGS = [...new Set(TAG_PRESETS.flatMap(p => p.tags))];

const DEEPSEEK_MODELS = [
  { value: 'deepseek/deepseek-v3.2',              label: 'DeepSeek V3.2' },
  { value: 'deepseek/deepseek-r1',                label: 'DeepSeek R1' },
  { value: 'anthropic/claude-opus-4-6',           label: 'Claude Opus 4.6' },
  { value: 'anthropic/claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
  { value: 'openai/gpt-4o',                       label: 'GPT-4o' },
  { value: 'google/gemini-2.0-flash-001',         label: 'Gemini 2.0 Flash' },
];

const SCREENING_MODELS = [
  { value: 'anthropic/claude-opus-4.5',   label: 'Claude Opus 4.5 (recommended)' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-opus-4-6',   label: 'Claude Opus 4.6' },
];

// ── Log panel ─────────────────────────────────────────────────────────────────
function LogPanel({ logs, running }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div style={{
      background: '#0d1117', borderRadius: 6, padding: '10px 14px',
      height: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12,
    }}>
      {logs.length === 0 && (
        <Text style={{ color: '#555' }}>No logs yet. Start a job to see output.</Text>
      )}
      {logs.map((entry, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, lineHeight: '1.7', alignItems: 'flex-start' }}>
          <span style={{ color: '#555', whiteSpace: 'nowrap', fontSize: 11 }}>
            {new Date(entry.ts).toLocaleTimeString()}
          </span>
          <span style={{ color: LOG_COLORS[entry.level] || '#d4d4d4', flex: 1, wordBreak: 'break-all' }}>
            {entry.level === 'error' ? '✖ ' : entry.level === 'warn' ? '⚠ ' : '  '}
            {entry.message}
            {entry.url && (
              <a href={entry.url} target="_blank" rel="noopener" style={{ marginLeft: 6, color: '#60a5fa' }}>
                <LinkOutlined />
              </a>
            )}
          </span>
        </div>
      ))}
      {running && <div style={{ color: '#555', marginTop: 4 }}>▋</div>}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Created tasks table ───────────────────────────────────────────────────────
const taskColumns = [
  {
    title: 'Task',
    key: 'task',
    render: (_, r) => (
      <div>
        <Link to={`/tasks/${r.taskId}`}>
          <Text style={{ fontSize: 12, fontWeight: 500 }}>{r.slug}</Text>
        </Link>
        {r.title && (
          <div>
            <Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: r.title }}>
              {r.title.slice(0, 60)}{r.title.length > 60 ? '…' : ''}
            </Text>
          </div>
        )}
      </div>
    ),
  },
  {
    title: 'Status',
    key: 'status',
    width: 90,
    render: (_, r) => r.submitted
      ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 10 }}>Submitted</Tag>
      : <Tag color="blue" icon={<ThunderboltOutlined />} style={{ fontSize: 10 }}>Polishing</Tag>,
  },
  {
    title: 'Domain',
    dataIndex: 'domain',
    key: 'domain',
    width: 130,
    render: (v) => v
      ? <Tag color="cyan" style={{ fontSize: 10 }}>{v}</Tag>
      : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
  },
  {
    title: 'Lint',
    dataIndex: 'lintScore',
    key: 'lint',
    width: 60,
    render: (score, r) => (
      <Tag color={r.lint?.ready ? 'success' : 'warning'} style={{ fontSize: 10 }}>{score}</Tag>
    ),
  },
];

// ── SO Preview table ──────────────────────────────────────────────────────────
const previewColumns = [
  {
    title: 'Title',
    dataIndex: 'title',
    key: 'title',
    render: (t, r) => (
      <a href={r.link} target="_blank" rel="noopener">
        <Text style={{ fontSize: 12 }}>{t}</Text>
      </a>
    ),
  },
  {
    title: 'Tags',
    dataIndex: 'tags',
    key: 'tags',
    width: 180,
    render: (tags) => tags.map(t => <Tag key={t} style={{ fontSize: 10, margin: '2px 1px' }}>{t}</Tag>),
  },
  {
    title: '▲',
    dataIndex: 'score',
    key: 'score',
    width: 50,
    render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
  },
  {
    title: '⌘',
    dataIndex: 'isTerminal',
    key: 'term',
    width: 40,
    render: (v) => v ? <Badge status="success" /> : <Badge status="default" />,
  },
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function Scraper() {
  const [form] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState([]);
  const [createdTasks, setCreatedTasks] = useState([]);
  const [discardedCount, setDiscardedCount] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [quotaRemaining, setQuotaRemaining] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [currentTask, setCurrentTask] = useState(null);

  // Watch toggle states for conditional rendering
  const screeningEnabled = Form.useWatch('screening', form);
  const polishEnabled = Form.useWatch('polish', form);

  // Load existing job status on mount
  useEffect(() => {
    getScrapeStatus().then(job => {
      if (!job) return;
      setRunning(job.running);
      setPaused(job.paused);
      setLogs(job.logs || []);
      setCreatedTasks(job.createdTasks || []);
      setProgress(job.progress || { current: 0, total: 0 });
    }).catch(() => {});


  }, []);

  // SSE subscription
  useSSE('/api/scrape/sse', {
    log:               (d) => setLogs(prev => [...prev, d]),
    started:           (d) => {
      setRunning(true); setPaused(false); setCurrentTask(null);
      setLogs([]); setCreatedTasks([]); setDiscardedCount(0);
      setProgress({ current: 0, total: d.config?.maxTasks || 0 });
    },
    done:              (d) => {
      setRunning(false); setPaused(false); setCurrentTask(null);
      message.success(`Scrape done — ${d.created ?? 0} created, ${d.discarded ?? 0} discarded`);
    },
    error:             (d) => { setRunning(false); setCurrentTask(null); message.error(d.message); },
    paused:            ()  => setPaused(true),
    resumed:           ()  => setPaused(false),
    progress:          (d) => setProgress(d),
    'task-start':      (d) => setCurrentTask(d),
    'task-done':       (d) => { setCreatedTasks(prev => [...prev, { ...d, submitted: false }]); setCurrentTask(null); },
    'screening-start': (d) => {
      setCurrentTask({ slug: d.slug, taskId: d.taskId, title: `Screening: ${d.slug}` });
      setLogs(prev => [...prev, { level: 'info', message: `[Screening] ${d.slug} — running harbor agent (1 attempt)…`, ts: new Date().toISOString() }]);
    },
    'screening-done':  (d) => {
      const msg = d.error
        ? `[Screening] ${d.slug} ⚠️ spawn error: ${d.error} (treated as pass)`
        : d.tooEasy
          ? `[Screening] ${d.slug} ❌ too easy — agent passed in ${d.elapsed}s → discarding`
          : d.timedOut
            ? `[Screening] ${d.slug} ✅ timed out after ${d.elapsed}s — appropriately hard`
            : `[Screening] ${d.slug} ✅ agent could not solve (exit=${d.exitCode}, ${d.elapsed}s) — keeping`;
      setLogs(prev => [...prev, { level: d.tooEasy ? 'warn' : 'info', message: msg, ts: new Date().toISOString() }]);
    },
    'task-discarded':  (d) => {
      setDiscardedCount(prev => prev + 1);
      setCurrentTask(null);
    },
    'polish-submitted': (d) => {
      setCreatedTasks(prev => prev.map(t => t.taskId === d.taskId ? { ...t, submitted: true } : t));
    },
    status:            (d) => {
      if (!d.running) return;
      setRunning(d.running);
      setPaused(d.paused);
      setLogs(d.logs || []);
      setCreatedTasks(d.createdTasks || []);
      setDiscardedCount((d.discardedTasks || []).length);
      setProgress(d.progress || { current: 0, total: 0 });
    },
  });

  // Monitor quotaRemaining from logs
  useEffect(() => {
    const last = [...logs].reverse().find(l => l.message?.includes('quota remaining:'));
    if (last) {
      const m = last.message.match(/quota remaining: (\d+)/);
      if (m) setQuotaRemaining(Number(m[1]));
    }
  }, [logs]);

  async function handleStart(values) {
    const config = {
      tags: values.tags?.join(';') || 'bash;linux',
      query: values.query || '',
      maxTasks: values.maxTasks,
      model: values.model,
      minScore: values.minScore,
      terminalOnly: values.terminalOnly,
      skipExisting: values.skipExisting,
      difficulty: values.difficulty || '',
      apiKey: values.soApiKey || '',
      screening: values.screening ?? true,
      screeningTimeout: values.screeningTimeout ?? 180,
      screeningModel: values.screeningModel || 'anthropic/claude-opus-4.5',
      polish: values.polish ?? true,
      polishMaxRounds: values.polishMaxRounds ?? 5,
      agentAttempts: values.agentAttempts ?? 1,
    };
    try {
      await startScrape(config);
    } catch (err) {
      message.error(err.response?.data?.error || err.message);
    }
  }

  async function handleStop() { await stopScrape(); }

  async function handlePauseResume() {
    if (paused) { await resumeScrape(); } else { await pauseScrape(); }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewData(null);
    const values = form.getFieldsValue();
    try {
      const result = await previewSO({
        tags: values.tags?.join(';'),
        query: values.query,
        pagesize: 15,
        minScore: values.minScore,
      });
      setPreviewData(result);
    } catch (err) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setPreviewing(false);
    }
  }

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space align="center">
          <RobotOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>SO Auto Scraper</Title>
          <Tag color="blue" style={{ fontSize: 11 }}>StackOverflow → Terminal-Bench</Tag>
        </Space>
      </div>

      <Row gutter={16}>
        {/* ── Config Panel (Redesigned) ── */}
        <Col span={10}>
          <Card
            title={
              <Space>
                <RobotOutlined style={{ color: '#1677ff' }} />
                <span>SO Auto Scraper</span>
              </Space>
            }
            size="small"
            styles={{ header: { background: '#fff', borderBottom: '1px solid #f0f0f0' } }}
          >
            <Form
              form={form}
              layout="vertical"
              size="small"
              onFinish={handleStart}
              initialValues={{
                tags: ['bash', 'linux'],
                maxTasks: 5,
                model: 'deepseek/deepseek-v3.2',
                minScore: 5,
                terminalOnly: true,
                skipExisting: true,
                difficulty: 'Medium',
                screening: true,
                screeningTimeout: 180,
                screeningModel: 'anthropic/claude-opus-4.5',
                polish: true,
                polishMaxRounds: 5,
                agentAttempts: 1,
              }}
            >
              {/* ── Tag Presets (pill-shaped) ── */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TAG_PRESETS.map(p => (
                    <Tag
                      key={p.label}
                      style={{
                        cursor: 'pointer',
                        fontSize: 11,
                        borderRadius: 100,
                        padding: '2px 14px',
                        userSelect: 'none',
                        transition: 'all 0.15s',
                        border: '1px solid #e8e8e8',
                      }}
                      onClick={() => form.setFieldValue('tags', p.tags)}
                    >
                      {p.label}
                    </Tag>
                  ))}
                </div>
              </div>

              {/* ── SO Tags ── */}
              <Form.Item label="SO Tags" name="tags" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Select
                  mode="tags"
                  placeholder="bash, linux, shell…"
                  options={ALL_TAGS.map(t => ({ value: t, label: t }))}
                />
              </Form.Item>

              {/* ── Row: AI Model + Max Tasks ── */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Form.Item label="AI Model" name="model" style={{ flex: 1, marginBottom: 0 }}>
                  <Select options={DEEPSEEK_MODELS} />
                </Form.Item>
                <Form.Item label="Max Tasks" name="maxTasks" style={{ width: 110, marginBottom: 0 }}>
                  <InputNumber min={1} max={50} style={{ width: '100%' }} />
                </Form.Item>
              </div>

              {/* ── Row: Min Score + Difficulty + Inline Switches ── */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
                <Form.Item label="Min Score" name="minScore" style={{ width: 90, marginBottom: 0 }}>
                  <InputNumber min={0} max={1000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Difficulty" name="difficulty" style={{ width: 120, marginBottom: 0 }}>
                  <Select>
                    <Select.Option value="Easy">Easy</Select.Option>
                    <Select.Option value="Medium">Medium</Select.Option>
                    <Select.Option value="Hard">Hard</Select.Option>
                  </Select>
                </Form.Item>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingBottom: 5, marginLeft: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Form.Item name="terminalOnly" valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch size="small" />
                    </Form.Item>
                    <Text style={{ fontSize: 11, color: '#595959', whiteSpace: 'nowrap' }}>Terminal-only</Text>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Form.Item name="skipExisting" valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch size="small" />
                    </Form.Item>
                    <Text style={{ fontSize: 11, color: '#595959', whiteSpace: 'nowrap' }}>Skip existing</Text>
                  </div>
                </div>
              </div>

              {/* ── Section: Pipeline Steps ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
                <div style={{ width: 4, height: 16, borderRadius: 2, background: '#1677ff' }} />
                <Text strong style={{ fontSize: 13, color: '#262626' }}>Pipeline Steps</Text>
              </div>

              {/* ── Screening Toggle Card ── */}
              <div style={{
                border: `1px solid ${screeningEnabled ? '#b7eb8f' : '#f0f0f0'}`,
                background: screeningEnabled ? '#f6ffed' : '#fafafa',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 10,
                transition: 'all 0.3s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space size={6}>
                    <Text strong style={{ fontSize: 12.5 }}>Screening</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>discard easy tasks</Text>
                  </Space>
                  <Form.Item name="screening" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch size="small" />
                  </Form.Item>
                </div>
                {screeningEnabled && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Tooltip title="If the agent solves the task within this time, it's too easy → discard">
                      <Form.Item label="Timeout (s)" name="screeningTimeout" style={{ marginBottom: 0, width: 110 }}>
                        <InputNumber min={60} max={600} step={30} style={{ width: '100%' }} />
                      </Form.Item>
                    </Tooltip>
                    <Form.Item label="Screening Model" name="screeningModel" style={{ marginBottom: 0, flex: 1 }}>
                      <Select options={SCREENING_MODELS} />
                    </Form.Item>
                  </div>
                )}
              </div>

              {/* ── Polish Toggle Card ── */}
              <div style={{
                border: `1px solid ${polishEnabled ? '#b7eb8f' : '#f0f0f0'}`,
                background: polishEnabled ? '#f6ffed' : '#fafafa',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 12,
                transition: 'all 0.3s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space size={6}>
                    <Text strong style={{ fontSize: 12.5 }}>Polish</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>lint fix → auto-submit</Text>
                  </Space>
                  <Form.Item name="polish" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch size="small" />
                  </Form.Item>
                </div>
                {polishEnabled && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Form.Item label="Max rounds" name="polishMaxRounds" style={{ marginBottom: 0, width: 100 }}>
                      <InputNumber min={1} max={10} step={1} style={{ width: '100%' }} />
                    </Form.Item>
                    <Tooltip title="Agent check: run terminus-2 N times to verify task difficulty. 0 = skip.">
                      <Form.Item label="Agent attempts" name="agentAttempts" style={{ marginBottom: 0, width: 140 }}>
                        <Select options={[
                          { value: 0, label: 'Skip (0)' },
                          { value: 1, label: '1 attempt' },
                          { value: 2, label: '2 attempts' },
                          { value: 4, label: '4 attempts' },
                        ]} />
                      </Form.Item>
                    </Tooltip>
                  </div>
                )}
              </div>

              {/* ── Advanced Settings (collapsed) ── */}
              <Collapse
                ghost
                size="small"
                style={{ marginBottom: 8 }}
                items={[{
                  key: 'advanced',
                  label: <Text type="secondary" style={{ fontSize: 12 }}>Advanced Settings</Text>,
                  children: (
                    <>
                      <Form.Item label="Title keyword (optional)" name="query" style={{ marginBottom: 10 }}>
                        <Input placeholder="e.g. find files, parse log" prefix={<SearchOutlined />} />
                      </Form.Item>
                      <Form.Item label="SO API Key" name="soApiKey" style={{ marginBottom: 10 }}>
                        <Input.Password placeholder="optional, for higher quota" size="small" />
                      </Form.Item>


                    </>
                  ),
                }]}
              />

              {/* ── Action Bar ── */}
              <div style={{
                borderTop: '1px solid #f0f0f0',
                paddingTop: 12,
                marginTop: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <Space>
                  {!running ? (
                    <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />}>
                      Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                        onClick={handlePauseResume}
                      >
                        {paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button danger icon={<StopOutlined />} onClick={handleStop}>Stop</Button>
                    </>
                  )}
                </Space>
                <Button icon={<EyeOutlined />} onClick={handlePreview} loading={previewing}>
                  Preview SO
                </Button>
              </div>
            </Form>

            {/* SO Preview */}
            {previewData && (
              <div style={{ marginTop: 12 }}>
                <Divider style={{ margin: '8px 0', fontSize: 12 }}>
                  Preview — {previewData.questions.length} questions · quota: {previewData.quota_remaining}
                </Divider>
                <Table
                  dataSource={previewData.questions}
                  columns={previewColumns}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  scroll={{ y: 200 }}
                />
              </div>
            )}
          </Card>
        </Col>

        {/* ── Live Output + Tasks ── */}
        <Col span={14}>
          {/* Stats Row */}
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={6}>
              <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                <Statistic
                  title={<span style={{ fontSize: 11 }}>Created</span>}
                  value={createdTasks.length}
                  valueStyle={{ fontSize: 22, color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                <Statistic
                  title={<span style={{ fontSize: 11 }}>Discarded</span>}
                  value={discardedCount}
                  valueStyle={{ fontSize: 22, color: '#faad14' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                <Statistic
                  title={<span style={{ fontSize: 11 }}>Submitted</span>}
                  value={createdTasks.filter(t => t.submitted).length}
                  valueStyle={{ fontSize: 22, color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                <Statistic
                  title={<span style={{ fontSize: 11 }}>SO Quota</span>}
                  value={quotaRemaining ?? '—'}
                  valueStyle={{
                    fontSize: 22,
                    color: quotaRemaining === null ? '#555' : quotaRemaining < 50 ? '#ff4d4f' : quotaRemaining < 200 ? '#faad14' : '#52c41a',
                  }}
                />
              </Card>
            </Col>
          </Row>

          {/* Live Log */}
          <Card
            title={
              <Space>
                <span>Live Output</span>
                {running && (
                  <>
                    <Badge
                      status={paused ? 'warning' : 'processing'}
                      text={paused ? 'Paused' : 'Running'}
                    />
                    {progress.total > 0 && (
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        {progress.current}/{progress.total}
                      </Tag>
                    )}
                    {currentTask && (
                      <Tag color="purple" style={{ fontSize: 10, maxWidth: 220 }}>
                        ↳ {currentTask.title?.slice(0, 40) || currentTask.slug || '…'}
                      </Tag>
                    )}
                  </>
                )}
                {!running && (createdTasks.length > 0 || discardedCount > 0) && (
                  <Badge status="success" text="Done" />
                )}
              </Space>
            }
            size="small"
            extra={
              <Space size="small">
                {running && progress.total > 0 && (
                  <Progress
                    percent={progressPct}
                    size="small"
                    style={{ width: 80, marginBottom: 0 }}
                    showInfo={false}
                  />
                )}
                <Button size="small" onClick={() => setLogs([])}>Clear</Button>
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            <LogPanel logs={logs} running={running} />
          </Card>

          {/* Created Tasks */}
          {createdTasks.length > 0 && (
            <Card
              title={
                <Space>
                  <span>Created Tasks</span>
                  <Tag color="green">{createdTasks.length} created</Tag>
                  {discardedCount > 0 && (
                    <Tag color="warning">{discardedCount} discarded (too easy)</Tag>
                  )}
                  {createdTasks.filter(t => t.submitted).length > 0 && (
                    <Tag color="blue">
                      {createdTasks.filter(t => t.submitted).length} submitted to TB
                    </Tag>
                  )}
                </Space>
              }
              size="small"
            >
              <Table
                dataSource={createdTasks}
                columns={taskColumns}
                rowKey="taskId"
                size="small"
                pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
              />
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
