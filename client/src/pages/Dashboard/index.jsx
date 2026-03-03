import React, { useEffect, useState, useCallback } from 'react';
import {
  Row, Col, Card, Statistic, Table, Tag, Badge, Typography,
  Space, Button, Spin, Tooltip, Progress, Alert, Divider, message
} from 'antd';
import {
  FileTextOutlined, SendOutlined, CheckCircleOutlined,
  CloseCircleOutlined, SyncOutlined, ClockCircleOutlined,
  TrophyOutlined, ReloadOutlined, RocketOutlined,
  DashboardOutlined, ThunderboltOutlined, DeleteOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getDashboard } from '../../api/dashboard.js';
import { getResources, cleanLogs, refreshResources } from '../../api/resources.js';

const { Title, Text } = Typography;

const DIFFICULTY_COLOR = { Easy: 'green', Medium: 'orange', Hard: 'red' };

const TASK_STATUS_COLOR = { draft: 'default', ready: 'success', submitted: 'processing', discarded: 'warning' };

const SUB_STATUS = {
  local:            { label: 'Local',         color: '#8c8c8c', icon: <FileTextOutlined /> },
  pending:          { label: 'Pending',        color: '#1677ff', icon: <ClockCircleOutlined /> },
  running:          { label: 'Running',        color: '#722ed1', icon: <SyncOutlined spin /> },
  AUTO_PASSED:      { label: 'Passed',         color: '#52c41a', icon: <CheckCircleOutlined /> },
  AUTO_FAILED:      { label: 'Failed',         color: '#ff4d4f', icon: <CloseCircleOutlined /> },
  APPROVED:         { label: 'Approved',       color: '#13c2c2', icon: <TrophyOutlined /> },
  REJECTED:         { label: 'Rejected',       color: '#fa541c', icon: <CloseCircleOutlined /> },
  review_requested: { label: 'Review Req.',    color: '#faad14', icon: <SendOutlined /> },
  CANCELLED:        { label: 'Cancelled',      color: '#bfbfbf', icon: <CloseCircleOutlined /> },
};

function StatCard({ title, value, icon, color, suffix }) {
  return (
    <Card size="small" styles={{ body: { padding: '16px 20px' } }}>
      <Statistic
        title={<Space>{icon}<span>{title}</span></Space>}
        value={value ?? 0}
        suffix={suffix}
        valueStyle={{ color, fontSize: 28, fontWeight: 700 }}
      />
    </Card>
  );
}

function SubmissionStatusBar({ data }) {
  if (!data) return null;
  const total = data.total || 1;
  const segments = [
    { key: 'auto_passed', label: 'Passed', color: '#52c41a' },
    { key: 'approved',    label: 'Approved', color: '#13c2c2' },
    { key: 'running',     label: 'Running', color: '#722ed1' },
    { key: 'pending',     label: 'Pending', color: '#1677ff' },
    { key: 'auto_failed', label: 'Failed', color: '#ff4d4f' },
    { key: 'rejected',    label: 'Rejected', color: '#fa541c' },
    { key: 'review_requested', label: 'Review', color: '#faad14' },
    { key: 'local',       label: 'Local', color: '#8c8c8c' },
  ].filter(s => data[s.key] > 0);

  return (
    <div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12, background: '#f0f0f0' }}>
        {segments.map(s => (
          <Tooltip key={s.key} title={`${s.label}: ${data[s.key]}`}>
            <div
              style={{
                width: `${(data[s.key] / total) * 100}%`,
                background: s.color,
                transition: 'width 0.4s',
              }}
            />
          </Tooltip>
        ))}
      </div>
      {/* Legend */}
      <Space wrap size={[16, 8]}>
        {segments.map(s => (
          <Space key={s.key} size={4}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <Text style={{ fontSize: 12 }}>{s.label} <Text strong>{data[s.key]}</Text></Text>
          </Space>
        ))}
      </Space>
    </div>
  );
}

// ── Resource Monitor Widget ───────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function MetricBar({ label, percent, extra }) {
  const color = percent >= 80 ? '#ff4d4f' : percent >= 60 ? '#faad14' : '#52c41a';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: 12 }}>{label}</Text>
        <Space size={4}>
          <Text strong style={{ fontSize: 12, color }}>{percent?.toFixed(1) ?? 0}%</Text>
          {extra && <Text type="secondary" style={{ fontSize: 11 }}>{extra}</Text>}
        </Space>
      </div>
      <Progress
        percent={percent ?? 0}
        showInfo={false}
        strokeColor={color}
        trailColor="#f0f0f0"
        size={['100%', 6]}
      />
    </div>
  );
}

function ResourceMonitor() {
  const [res, setRes] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getResources();
      setRes(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function handleClean() {
    setCleaning(true);
    try {
      const result = await cleanLogs();
      message.success(result.message);
      await load();
    } catch (err) {
      message.error('Clean failed: ' + err.message);
    } finally {
      setCleaning(false);
    }
  }

  if (!res) return <Spin size="small" style={{ margin: 8 }} />;

  const { cpu, memory, disk, queue, diskCleanThreshold, lastChecked, lastCleaned, lastCleanedDirs } = res;
  const diskWarning = disk?.percent >= diskCleanThreshold;

  return (
    <Card
      size="small"
      title={<Space><DashboardOutlined /><span>Host Resources</span></Space>}
      extra={
        <Space size={6}>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleClean}
            loading={cleaning}
            danger={diskWarning}
            title="Clean harbor_jobs & post_logs for completed/discarded tasks"
          >
            Clean Logs
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={load} />
        </Space>
      }
    >
      <Row gutter={16}>
        <Col span={14}>
          <MetricBar
            label={`CPU  (${cpu?.count} cores, load ${cpu?.load1?.toFixed(2)})`}
            percent={cpu?.percent}
          />
          <MetricBar
            label="Memory"
            percent={memory?.percent}
            extra={`${fmtBytes(memory?.used)} / ${fmtBytes(memory?.total)}`}
          />
          <MetricBar
            label={`Disk${diskWarning ? '  ⚠ auto-clean at ' + diskCleanThreshold + '%' : ''}`}
            percent={disk?.percent}
            extra={`${fmtBytes(disk?.used)} / ${fmtBytes(disk?.total)}`}
          />
          {diskWarning && lastCleaned && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Last cleaned: {new Date(lastCleaned).toLocaleTimeString()} ({lastCleanedDirs} dirs)
            </Text>
          )}
        </Col>
        <Col span={10}>
          <Card size="small" style={{ background: '#fafafa' }} styles={{ body: { padding: '8px 12px' } }}>
            <Text strong style={{ fontSize: 12 }}>
              <ApiOutlined /> API Queue
            </Text>
            <Divider style={{ margin: '6px 0' }} />
            <div style={{ fontSize: 12, lineHeight: 2 }}>
              <div>
                <Text type="secondary">Active: </Text>
                <Text strong style={{ color: queue?.activeApiCalls > 0 ? '#722ed1' : '#52c41a' }}>
                  {queue?.activeApiCalls ?? 0} / {queue?.maxConcurrentApi ?? 3}
                </Text>
              </div>
              <div>
                <Text type="secondary">Waiting: </Text>
                <Text strong>{queue?.waitingApiCalls ?? 0}</Text>
              </div>
              <div>
                <Text type="secondary">CPU gate: </Text>
                <Text>{queue?.cpuThreshold ?? 80}%</Text>
              </div>
              <div>
                <Text type="secondary">Mem gate: </Text>
                <Text>{queue?.memoryThreshold ?? 90}%</Text>
              </div>
            </div>
          </Card>
          {lastChecked && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, textAlign: 'right' }}>
              Updated {new Date(lastChecked).toLocaleTimeString()}
            </Text>
          )}
        </Col>
      </Row>
    </Card>
  );
}

// ── Submission columns ────────────────────────────────────────────────────────

const recentSubColumns = [
  {
    title: 'Task',
    key: 'task',
    render: (_, r) => (
      <Link to={`/tasks/${r.task_id || r.id}`}>
        <Text style={{ fontSize: 13 }}>{r.task_slug}</Text>
      </Link>
    ),
    width: 160,
  },
  {
    title: 'Status',
    dataIndex: 'status',
    key: 'status',
    width: 130,
    render: (v) => {
      const s = SUB_STATUS[v] || { label: v, color: '#8c8c8c', icon: null };
      return (
        <Space size={4}>
          <span style={{ color: s.color }}>{s.icon}</span>
          <Text style={{ color: s.color, fontSize: 13, fontWeight: 600 }}>{s.label}</Text>
        </Space>
      );
    },
  },
  {
    title: 'Points',
    dataIndex: 'task_points',
    key: 'points',
    width: 70,
    render: (v) => v ? <Text strong style={{ color: '#52c41a' }}>{v}</Text> : <Text type="secondary">—</Text>,
  },
  {
    title: 'Fail Reason',
    dataIndex: 'agent_fail_reason',
    key: 'fail',
    render: (v) => v
      ? <Text type="danger" style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>{v}</Text>
      : <Text type="secondary">—</Text>,
  },
  {
    title: 'Retries',
    dataIndex: 'retry_count',
    key: 'retry',
    width: 60,
    render: (v) => v > 0 ? <Tag color="orange">{v}×</Tag> : <Text type="secondary">0</Text>,
  },
  {
    title: 'Updated',
    dataIndex: 'updated_at',
    key: 'updated',
    width: 100,
    render: (v) => (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        <br />
        <span style={{ fontSize: 11 }}>{new Date(v).toLocaleDateString()}</span>
      </Text>
    ),
  },
];

const recentTaskColumns = [
  {
    title: 'Task',
    key: 'task',
    render: (_, r) => (
      <Link to={`/tasks/${r.id}`}>
        <Text style={{ fontSize: 13 }}>{r.slug}</Text>
      </Link>
    ),
  },
  {
    title: 'Difficulty',
    dataIndex: 'difficulty',
    key: 'diff',
    width: 80,
    render: (v) => v ? <Tag color={DIFFICULTY_COLOR[v]}>{v}</Tag> : '—',
  },
  {
    title: 'Status',
    dataIndex: 'status',
    key: 'status',
    width: 90,
    render: (v) => <Badge status={TASK_STATUS_COLOR[v] || 'default'} text={v} />,
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    key: 'created',
    width: 90,
    render: (v) => (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {new Date(v).toLocaleDateString()}
      </Text>
    ),
  },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await getDashboard();
      setData(result);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return (
    <Alert
      type="error"
      message="Dashboard unavailable"
      description={error}
      action={<Button size="small" onClick={load}>Retry</Button>}
      style={{ maxWidth: 600 }}
    />
  );

  const t = data?.tasks || {};
  const s = data?.submissions || {};
  const passRate = s.total > 0
    ? Math.round(((s.auto_passed + s.approved) / s.total) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Space align="center">
          <RocketOutlined style={{ fontSize: 22, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
        </Space>
        <Space>
          {lastRefresh && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </Text>
          )}
          <Button icon={<ReloadOutlined />} onClick={load} size="small">Refresh</Button>
        </Space>
      </div>

      {/* Resource Monitor */}
      <div style={{ marginBottom: 12 }}>
        <ResourceMonitor />
      </div>

      {/* Task Stats Row */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col span={5}>
          <StatCard title="Total Tasks" value={t.total} icon={<FileTextOutlined />} color="#1677ff" />
        </Col>
        <Col span={5}>
          <StatCard title="Draft" value={t.draft} icon={<FileTextOutlined style={{ color: '#8c8c8c' }} />} color="#8c8c8c" />
        </Col>
        <Col span={4}>
          <StatCard title="Ready" value={t.ready} icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />} color="#52c41a" />
        </Col>
        <Col span={5}>
          <StatCard title="Submitted" value={t.submitted} icon={<SendOutlined style={{ color: '#722ed1' }} />} color="#722ed1" />
        </Col>
        <Col span={5}>
          <StatCard title="Discarded" value={t.discarded ?? 0} icon={<CloseCircleOutlined style={{ color: '#faad14' }} />} color="#faad14" />
        </Col>
      </Row>

      {/* Submission Stats Row */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <StatCard title="Total Submissions" value={s.total} icon={<SendOutlined />} color="#1677ff" />
        </Col>
        <Col span={6}>
          <StatCard
            title="Passed + Approved"
            value={(s.auto_passed || 0) + (s.approved || 0)}
            icon={<TrophyOutlined style={{ color: '#52c41a' }} />}
            color="#52c41a"
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="In Progress"
            value={(s.pending || 0) + (s.running || 0)}
            icon={<SyncOutlined style={{ color: '#722ed1' }} />}
            color="#722ed1"
          />
        </Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title={<Space><TrophyOutlined /><span>Pass Rate</span></Space>}
              value={passRate}
              suffix="%"
              valueStyle={{ color: passRate >= 60 ? '#52c41a' : passRate >= 30 ? '#faad14' : '#ff4d4f', fontSize: 28, fontWeight: 700 }}
            />
            <Progress
              percent={passRate}
              showInfo={false}
              strokeColor={passRate >= 60 ? '#52c41a' : passRate >= 30 ? '#faad14' : '#ff4d4f'}
              size="small"
              style={{ marginTop: 4 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Submission Status Distribution */}
      {s.total > 0 && (
        <Card
          title="Submission Status Distribution"
          size="small"
          style={{ marginBottom: 12 }}
          extra={<Text type="secondary">{s.total} total</Text>}
        >
          <SubmissionStatusBar data={s} />
        </Card>
      )}

      {/* Bottom tables */}
      <Row gutter={12}>
        <Col span={14}>
          <Card
            title="Recent Submissions"
            size="small"
            extra={<Link to="/submissions">View all →</Link>}
          >
            <Table
              dataSource={data?.recentSubmissions || []}
              columns={recentSubColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: 'No submissions yet' }}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card
            title="Recent Tasks"
            size="small"
            extra={<Link to="/tasks">View all →</Link>}
          >
            <Table
              dataSource={data?.recentTasks || []}
              columns={recentTaskColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: 'No tasks yet' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
