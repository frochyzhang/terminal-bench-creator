import api from './client.js';

export const getSubmissions = (params) => api.get('/submissions', { params }).then(r => r.data);
export const getSubmission = (id) => api.get(`/submissions/${id}`).then(r => r.data);
export const retrySubmission = (id) => api.post(`/submissions/${id}/retry`).then(r => r.data);
export const reviewSubmission = (id) => api.post(`/submissions/${id}/review`).then(r => r.data);
export const getSubmissionLogs = (id) => api.get(`/submissions/${id}/logs`).then(r => r.data);
