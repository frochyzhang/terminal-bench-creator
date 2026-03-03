import React, { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Typography, Modal, Form, Input, Select,
  Popconfirm, message, Tooltip, Badge
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { getTasks, createTask, deleteTask } from '../../api/tasks.js';

const { Title } = Typography;

const STATUS_COLORS = {
  draft: 'default',
  ready: 'success',
  submitted: 'processing',
};

const DIFFICULTY_COLORS = {
  Easy: 'green',
  Medium: 'orange',
  Hard: 'red',
};

export default function TaskList() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(null);
  const [createModal, setCreateModal] = useState(false);
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTasks();
  }, [page, statusFilter]);

  async function loadTasks() {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const data = await getTasks(params);
      setTasks(data.data);
      setTotal(data.total);
    } catch (err) {
      message.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(values) {
    setCreating(true);
    try {
      const task = await createTask(values);
      message.success('Task created');
      setCreateModal(false);
      form.resetFields();
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create task');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id, slug) {
    try {
      await deleteTask(id);
      message.success(`Task "${slug}" deleted`);
      loadTasks();
    } catch (err) {
      message.error('Failed to delete task');
    }
  }

  const columns = [
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      render: (slug, record) => (
        <Link to={`/tasks/${record.id}`}>{slug}</Link>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (v) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: 'Difficulty',
      dataIndex: 'difficulty',
      key: 'difficulty',
      render: (v) => v ? <Tag color={DIFFICULTY_COLORS[v]}>{v}</Tag> : '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <Badge status={STATUS_COLORS[v] || 'default'} text={v} />,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v) => new Date(v).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => navigate(`/tasks/${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title={`Delete task "${record.slug}"?`}
            onConfirm={() => handleDelete(record.id, record.slug)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Tasks</Title>
        <Space>
          <Select
            placeholder="Filter by status"
            allowClear
            style={{ width: 160 }}
            onChange={setStatusFilter}
          >
            <Select.Option value="draft">Draft</Select.Option>
            <Select.Option value="ready">Ready</Select.Option>
            <Select.Option value="submitted">Submitted</Select.Option>
          </Select>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>
            New Task
          </Button>
        </Space>
      </div>

      <Table
        dataSource={tasks}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `${t} tasks`,
        }}
      />

      <Modal
        title="Create New Task"
        open={createModal}
        onCancel={() => { setCreateModal(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={creating}
        okText="Create"
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="slug"
            label="Slug (kebab-case)"
            rules={[
              { required: true },
              { pattern: /^[a-z0-9][a-z0-9-]*$/, message: 'Use lowercase letters, numbers, and hyphens' }
            ]}
          >
            <Input placeholder="my-task-name" />
          </Form.Item>
          <Form.Item name="title" label="Title">
            <Input placeholder="Human-readable title" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Brief task description for AI generation..." />
          </Form.Item>
          <Form.Item name="category" label="Category">
            <Select placeholder="Select category">
              {['filesystem', 'networking', 'process', 'text-processing', 'data', 'scripting', 'system', 'general'].map(c => (
                <Select.Option key={c} value={c}>{c}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="difficulty" label="Difficulty" initialValue="Easy">
            <Select>
              <Select.Option value="Easy">Easy</Select.Option>
              <Select.Option value="Medium">Medium</Select.Option>
              <Select.Option value="Hard">Hard</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
