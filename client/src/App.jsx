import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Layout, Menu, Typography } from 'antd';
import {
  UnorderedListOutlined,
  SendOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import AppRouter from './router.jsx';

const { Content, Sider } = Layout;
const { Title } = Typography;

function AppLayout() {
  const location = useLocation();

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: <Link to="/">Dashboard</Link>,
    },
    {
      key: '/tasks',
      icon: <UnorderedListOutlined />,
      label: <Link to="/tasks">Tasks</Link>,
    },
    {
      key: '/scraper',
      icon: <RobotOutlined />,
      label: <Link to="/scraper">Auto Scraper</Link>,
    },
    {
      key: '/submissions',
      icon: <SendOutlined />,
      label: <Link to="/submissions">Submissions</Link>,
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings">Settings</Link>,
    },
  ];

  // Match top-level path; root "/" should highlight Dashboard
  const topPath = '/' + location.pathname.split('/')[1];
  const selectedKey = topPath === '/' ? '/' : topPath;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={5} style={{ margin: 0, color: '#1677ff' }}>TB Station</Title>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Content style={{ padding: 24, background: '#f5f5f5', minHeight: '100vh' }}>
          <AppRouter />
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
