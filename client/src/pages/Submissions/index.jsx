import React, { useEffect, useState } from 'react';
import {
  Table, Button, Space, Typography, Badge, message, Popconfirm,
  Select, Tooltip, Modal, Tag, Descriptions, Divider, Alert, Spin
} from 'antd';
import {
  SyncOutlined, UserOutlined, FileTextOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  getSubmissions, retrySubmission, reviewSubmission, getSubmissionLogs,
} from '../../api/submissions.js';

const { Title, Text, Paragraph } = Typography;

const STATUS_MAP = {
  local:            { badge: 'default',    label: 'Local' },
  pending:          { badge: 'processing', label: 'Pending' },
  running:          { badge: 'processing', label: 'Running' },
  AUTO_PASSED:      { badge: 'success',    label: 'Passed' },
  AUTO_FAILED:      { badge: 'error',      label: 'Failed' },
  APPROVED:         { badge: 'success',    label: 'Approved' },
  REJECTED:         { badge: 'error',      label: 'Rejected' },
  CANCELLED:        { badge: 'default',    label: 'Cancelled' },
  review_requested: { badge: 'warning',    label: 'Review Req.' },
};

// ── Log renderer ────────────────────────────────────────────────────────────

function LogLine({ text }) {
  const lower = text.toLowerCase();
  let color = '#d4d4d4';
  if (/error|fail|fatal|exception/i.test(text)) color = '#f87171';
  else if (/warn/i.test(text)) color = '#fbbf24';
  else if (/pass|success|ok\b|done/i.test(text)) color = '#4ade80';
  else if (/^[>\$#]/.test(text.trim())) color = '#60a5fa'; // shell prompts
  else if (/^\s*\d{4}-\d{2}-\d{2}/.test(text)) color = '#a78bfa'; // timestamps

  return (
    <div style={{ color, lineHeight: '1.6', fontFamily: 'monospace', fontSize: 12 }}>
      {text}
    </div>
  );
}

function StructuredLogs({ logs }) {
  // Handle string logs (raw text)
  if (typeof logs === 'string') {
    const lines = logs.split('\n');
    return (
      <div style={{
        background: '#0d1117', borderRadius: 6, padding: '12px 16px',
        maxHeight: 480, overflowY: 'auto',
      }}>
        {lines.map((line, i) => <LogLine key={i} text={line} />)}
      </div>
    );
  }

  // Handle error object
  if (logs?.error) {
    return <Alert type="error" message="Failed to load logs" description={logs.error} />;
  }

  // Handle structured object from TB API
  const {
    status, agent_fail_reason, task_points, stdout, stderr,
    agent_output, logs: rawLogs, error_analysis, events,
  } = logs;

  const mainLog = stdout || agent_output || rawLogs || null;
  const errLog = stderr || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Meta info */}
      <Descriptions size="small" column={2} bordered>
        {status && (
          <Descriptions.Item label="Status" span={1}>
            <Badge
              status={STATUS_MAP[status]?.badge || 'default'}
              text={STATUS_MAP[status]?.label || status}
            />
          </Descriptions.Item>
        )}
        {task_points !== undefined && task_points !== null && (
          <Descriptions.Item label="Points" span={1}>
            <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{task_points}</Text>
          </Descriptions.Item>
        )}
        {agent_fail_reason && (
          <Descriptions.Item label="Fail Reason" span={2}>
            <Text type="danger">{agent_fail_reason}</Text>
          </Descriptions.Item>
        )}
        {error_analysis && (
          <Descriptions.Item label="Error Analysis" span={2}>
            <Text>{error_analysis}</Text>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* Events timeline */}
      {Array.isArray(events) && events.length > 0 && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>Events</Text>
          <div style={{
            background: '#0d1117', borderRadius: 6, padding: '12px 16px',
            maxHeight: 180, overflowY: 'auto',
          }}>
            {events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                <Text style={{ color: '#a78bfa', fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : `#${i + 1}`}
                </Text>
                <Text style={{ color: '#d4d4d4', fontSize: 12, fontFamily: 'monospace' }}>
                  {ev.event || ev.type || ev.message || JSON.stringify(ev)}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stdout / agent output */}
      {mainLog && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>
            {stdout ? 'stdout' : 'Agent Output'}
          </Text>
          <div style={{
            background: '#0d1117', borderRadius: 6, padding: '12px 16px',
            maxHeight: 280, overflowY: 'auto',
          }}>
            {String(mainLog).split('\n').map((line, i) => <LogLine key={i} text={line} />)}
          </div>
        </div>
      )}

      {/* Stderr */}
      {errLog && (
        <div>
          <Text strong type="danger" style={{ display: 'block', marginBottom: 6 }}>stderr</Text>
          <div style={{
            background: '#1a0a0a', borderRadius: 6, padding: '12px 16px',
            maxHeight: 180, overflowY: 'auto',
          }}>
            {String(errLog).split('\n').map((line, i) => (
              <div key={i} style={{ color: '#f87171', fontFamily: 'monospace', fontSize: 12, lineHeight: '1.6' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: dump remaining unknown fields */}
      {!mainLog && !errLog && !Array.isArray(events) && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>Raw Response</Text>
          <div style={{
            background: '#0d1117', borderRadius: 6, padding: '12px 16px',
            maxHeight: 360, overflowY: 'auto',
          }}>
            {JSON.stringify(logs, null, 2).split('\n').map((line, i) => (
              <LogLine key={i} text={line} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Submissions() {
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(null);
  const [logsModal, setLogsModal] = useState(null);   // submission row
  const [logs, setLogs] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    loadSubmissions();
    const interval = setInterval(loadSubmissions, 15000);
    return () => clearInterval(interval);
  }, [page, statusFilter]);

  async function loadSubmissions() {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const data = await getSubmissions(params);
      setSubmissions(data.data);
      setTotal(data.total);
    } catch {
      message.error('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry(id) {
    try {
      await retrySubmission(id);
      message.success('Retry submitted');
      loadSubmissions();
    } catch (err) {
      message.error(err.response?.data?.error || 'Retry failed');
    }
  }

  async function handleReview(id) {
    try {
      await reviewSubmission(id);
      message.success('Review requested');
      loadSubmissions();
    } catch (err) {
      message.error(err.response?.data?.error || 'Review request failed');
    }
  }

  async function handleViewLogs(record) {
    setLogsModal(record);
    setLogs(null);
    setLogsLoading(true);
    try {
      const data = await getSubmissionLogs(record.id);
      setLogs(data);
    } catch (err) {
      setLogs({ error: err.response?.data?.error || err.message });
    } finally {
      setLogsLoading(false);
    }
  }

  const columns = [
    {
      title: 'Task',
      key: 'task',
      render: (_, r) => (
        <Link to={`/tasks/${r.task_id}`}>
          <Text style={{ fontSize: 13 }}>{r.task_slug}</Text>
        </Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => {
        const info = STATUS_MAP[v] || { badge: 'default', label: v };
        return <Badge status={info.badge} text={info.label} />;
      },
    },
    {
      title: 'TB ID',
      dataIndex: 'tb_submission_id',
      key: 'tb_id',
      render: (v) => v
        ? <Text code style={{ fontSize: 11 }}>{v.slice(0, 10)}…</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Points',
      dataIndex: 'task_points',
      key: 'points',
      render: (v) => v
        ? <Text strong style={{ color: '#52c41a' }}>{v}</Text>
        : <Text type="secondary">—</Text>,
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
      title: 'Retry',
      dataIndex: 'retry_count',
      key: 'retry',
      width: 60,
      render: (v) => v > 0 ? <Tag color="orange">{v}×</Tag> : '0',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      render: (v) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(v).toLocaleString()}
        </Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          {record.tb_submission_id && (
            <Tooltip title="View Logs">
              <Button
                icon={<FileTextOutlined />}
                size="small"
                onClick={() => handleViewLogs(record)}
              />
            </Tooltip>
          )}
          {['AUTO_FAILED', 'REJECTED', 'CANCELLED'].includes(record.status) && (
            <Popconfirm title="Retry this submission?" onConfirm={() => handleRetry(record.id)}>
              <Button icon={<SyncOutlined />} size="small">Retry</Button>
            </Popconfirm>
          )}
          {record.status === 'AUTO_PASSED' && (
            <Popconfirm title="Request human review?" onConfirm={() => handleReview(record.id)}>
              <Button icon={<UserOutlined />} size="small" type="primary">Review</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Submissions</Title>
        <Space>
          <Select
            placeholder="Filter by status"
            allowClear
            style={{ width: 180 }}
            onChange={setStatusFilter}
          >
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <Select.Option key={k} value={k}>{v.label}</Select.Option>
            ))}
          </Select>
          <Button icon={<SyncOutlined />} onClick={loadSubmissions}>Refresh</Button>
        </Space>
      </div>

      <Table
        dataSource={submissions}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `${t} submissions`,
        }}
      />

      {/* Logs Modal */}
      <Modal
        title={
          logsModal && (
            <Space>
              <FileTextOutlined />
              <span>Logs — {logsModal.task_slug}</span>
              {logsModal.status && (
                <Badge
                  status={STATUS_MAP[logsModal.status]?.badge || 'default'}
                  text={STATUS_MAP[logsModal.status]?.label || logsModal.status}
                />
              )}
            </Space>
          )
        }
        open={!!logsModal}
        onCancel={() => { setLogsModal(null); setLogs(null); }}
        footer={null}
        width={820}
        styles={{ body: { padding: '16px 20px' } }}
      >
        {logsLoading
          ? <div style={{ textAlign: 'center', padding: 48 }}><Spin tip="Loading logs…" /></div>
          : <StructuredLogs logs={logs} />
        }
      </Modal>
    </div>
  );
}
