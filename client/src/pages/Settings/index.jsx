import React, { useEffect, useState } from 'react';
import {
  Card, Form, Input, Select, Button, Space, Alert, Typography, Divider, message, Spin
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { getSettings, updateSettings, testConnection } from '../../api/settings.js';

const { Title, Text } = Typography;

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [rawSettings, setRawSettings] = useState({});

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
        formValues[key] = info.isSensitive ? '' : info.value;
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
      // Only send non-empty values (don't overwrite secrets with empty)
      const updates = {};
      for (const [key, val] of Object.entries(values)) {
        if (val !== '' && val !== null && val !== undefined) {
          updates[key] = val;
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
      const updates = {};
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

      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Card title="AI Provider" style={{ marginBottom: 16 }}>
          <Form.Item name="ai_provider" label="Provider">
            <Select>
              <Select.Option value="anthropic">Anthropic (Direct)</Select.Option>
              <Select.Option value="openrouter">OpenRouter</Select.Option>
            </Select>
          </Form.Item>

          <Divider>Anthropic</Divider>
          <Form.Item name="anthropic_api_key" label="Anthropic API Key">
            <Input.Password
              placeholder={rawSettings.anthropic_api_key?.value || 'sk-ant-...'}
            />
          </Form.Item>
          <Form.Item name="anthropic_model" label="Model">
            <Select>
              <Select.Option value="claude-opus-4-6">claude-opus-4-6 (Recommended)</Select.Option>
              <Select.Option value="claude-sonnet-4-6">claude-sonnet-4-6</Select.Option>
              <Select.Option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</Select.Option>
            </Select>
          </Form.Item>

          <Divider>OpenRouter</Divider>
          <Form.Item name="openrouter_api_key" label="OpenRouter API Key">
            <Input.Password placeholder="sk-or-..." />
          </Form.Item>
          <Form.Item name="openrouter_model" label="Model">
            <Input placeholder="anthropic/claude-opus-4-6" />
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

        <Button type="primary" htmlType="submit" loading={saving} size="large">
          Save Settings
        </Button>
      </Form>
    </div>
  );
}
