import React, { useEffect, useState } from 'react';
import {
  Card, Form, Input, InputNumber, Switch, Button, Space, Row, Col,
  Typography, Divider, message, Spin,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { getSettings, updateSettings, testConnection } from '../../api/settings.js';

const { Title, Text } = Typography;

const BOOLEAN_KEYS = new Set(['rate_control_enabled']);
const NUMBER_KEYS  = new Set([
  'rate_so_delay', 'rate_ai_delay', 'rate_task_delay',
  'queue_max_concurrent', 'queue_cpu_threshold', 'queue_mem_threshold',
]);

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [rawSettings, setRawSettings] = useState({});
  const rateEnabled = Form.useWatch('rate_control_enabled', form);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const data = await getSettings();
      setRawSettings(data);
      const formValues = {};
      for (const [key, info] of Object.entries(data)) {
        if (info.isSensitive) {
          formValues[key] = '';
        } else if (BOOLEAN_KEYS.has(key)) {
          formValues[key] = info.value !== 'false';
        } else if (NUMBER_KEYS.has(key)) {
          formValues[key] = info.value != null ? Number(info.value) : undefined;
        } else {
          formValues[key] = info.value;
        }
      }
      form.setFieldsValue(formValues);
    } catch (err) {
      message.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(values) {
    setSaving(true);
    try {
      const updates = {
        ai_provider: 'poe',
      };
      for (const [key, val] of Object.entries(values)) {
        if (val !== '' && val !== null && val !== undefined) {
          updates[key] = (typeof val === 'boolean' || typeof val === 'number') ? String(val) : val;
        }
      }
      await updateSettings(updates);
      message.success('Settings saved');
      loadSettings();
    } catch (err) {
      message.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      // Save current form values first
      const values = form.getFieldsValue();
      const updates = {
        ai_provider: 'poe',
      };
      for (const [key, val] of Object.entries(values)) {
        if (val !== '' && val !== null && val !== undefined) {
          updates[key] = val;
        }
      }
      await updateSettings(updates);
      const result = await testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 700 }}>
      <Title level={3}>Settings</Title>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={{
          rate_control_enabled: true,
          rate_so_delay: 2000,
          rate_ai_delay: 2000,
          rate_task_delay: 3000,
          queue_max_concurrent: 3,
          queue_cpu_threshold: 80,
          queue_mem_threshold: 90,
        }}
      >
        <Card title="AI Provider" style={{ marginBottom: 16 }}>
          <Divider>Poe</Divider>
          <Form.Item name="poe_api_key" label="Poe API Key">
            <Input.Password
              placeholder={rawSettings.poe_api_key?.value || 'sk-poe-...'}
            />
          </Form.Item>
          <Form.Item name="poe_model" label="Model">
            <Input placeholder="Claude-Sonnet-4.5" />
          </Form.Item>
          <Form.Item name="poe_api_base" label="API Base URL">
            <Input placeholder="https://api.poe.com/v1" />
          </Form.Item>
        </Card>

        <Card
          title="Terminal-Bench Platform"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              {testResult && (
                testResult.success
                  ? <Text type="success"><CheckCircleOutlined /> Connected</Text>
                  : <Text type="danger"><CloseCircleOutlined /> {testResult.message}</Text>
              )}
              <Button onClick={handleTestConnection} loading={testing}>
                Test Connection
              </Button>
            </Space>
          }
        >
          <Form.Item name="tb_base_url" label="Base URL">
            <Input placeholder="https://terminal-bench.com" />
          </Form.Item>
          <Form.Item name="tb_email" label="Email">
            <Input placeholder="your@email.com" />
          </Form.Item>
          <Form.Item name="tb_password" label="Password">
            <Input.Password placeholder="••••••••" />
          </Form.Item>
        </Card>

        <Card
          title="Rate Control"
          style={{ marginBottom: 16 }}
          extra={
            <Form.Item name="rate_control_enabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch checkedChildren="ON" unCheckedChildren="OFF" />
            </Form.Item>
          }
        >
          {rateEnabled ? (
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="rate_so_delay" label="SO Delay (ms)">
                  <InputNumber min={0} max={30000} step={500} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="rate_ai_delay" label="AI Delay (ms)">
                  <InputNumber min={0} max={30000} step={500} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="rate_task_delay" label="Task Delay (ms)">
                  <InputNumber min={0} max={30000} step={500} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Text type="secondary">Rate limiting disabled — all delays are 0.</Text>
          )}
        </Card>

        <Card title="Queue Limits" style={{ marginBottom: 16 }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="queue_max_concurrent" label="API Concurrency">
                <InputNumber min={1} max={20} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="queue_cpu_threshold" label="CPU Gate (%)">
                <InputNumber min={10} max={100} step={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="queue_mem_threshold" label="MEM Gate (%)">
                <InputNumber min={10} max={100} step={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Button type="primary" htmlType="submit" loading={saving} size="large">
          Save Settings
        </Button>
      </Form>
    </div>
  );
}
