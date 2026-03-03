import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const getDashboard = () => api.get('/dashboard').then(r => r.data);
