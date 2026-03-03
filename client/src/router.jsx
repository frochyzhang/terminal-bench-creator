import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spin } from 'antd';

const Dashboard = lazy(() => import('./pages/Dashboard/index.jsx'));
const Scraper = lazy(() => import('./pages/Scraper/index.jsx'));
const TaskList = lazy(() => import('./pages/TaskList/index.jsx'));
const TaskDetail = lazy(() => import('./pages/TaskDetail/index.jsx'));
const Submissions = lazy(() => import('./pages/Submissions/index.jsx'));
const Settings = lazy(() => import('./pages/Settings/index.jsx'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
    <Spin size="large" />
  </div>
);

export default function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scraper" element={<Scraper />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/submissions" element={<Submissions />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
