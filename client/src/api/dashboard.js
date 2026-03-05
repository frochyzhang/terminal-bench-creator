import api from './client.js';

export const getDashboard = () => api.get('/dashboard').then(r => r.data);
