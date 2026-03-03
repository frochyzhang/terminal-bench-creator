import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const getTasks = (params) => api.get('/tasks', { params }).then(r => r.data);
export const getTask = (id) => api.get(`/tasks/${id}`).then(r => r.data);
export const createTask = (data) => api.post('/tasks', data).then(r => r.data);
export const updateTask = (id, data) => api.patch(`/tasks/${id}`, data).then(r => r.data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`).then(r => r.data);

export const getTaskFiles = (id) => api.get(`/tasks/${id}/files`).then(r => r.data);
export const saveTaskFile = (id, filename, content) =>
  api.put(`/tasks/${id}/files/${filename}`, { content }).then(r => r.data);

export const lintTask = (id) => api.post(`/tasks/${id}/lint`).then(r => r.data);
export const submitTask = (id) => api.post(`/tasks/${id}/submit`).then(r => r.data);

export const startVerify = (id, opts) => api.post(`/tasks/${id}/verify`, opts).then(r => r.data);
export const stopVerify = (id) => api.post(`/tasks/${id}/verify/stop`).then(r => r.data);
export const getVerifyStatus = (id) => api.get(`/tasks/${id}/verify`).then(r => r.data);

export const startPolish = (id, opts) => api.post(`/tasks/${id}/polish`, opts).then(r => r.data);
export const stopPolish = (id) => api.post(`/tasks/${id}/polish/stop`).then(r => r.data);
export const getPolishStatus = (id) => api.get(`/tasks/${id}/polish`).then(r => r.data);
