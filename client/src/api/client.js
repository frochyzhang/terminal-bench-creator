import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(
  (config) => {
    console.group('📡 API Request');
    console.log('Method:', config.method?.toUpperCase());
    console.log('URL:', config.url);
    console.log('Full URL:', config.baseURL + config.url);
    if (config.params && Object.keys(config.params).length > 0) {
      console.log('Query Params:', config.params);
    }
    if (config.data && Object.keys(config.data).length > 0) {
      console.log('Request Body:', config.data);
    }
    console.log('Headers:', config.headers);
    console.groupEnd();
    return config;
  },
  (error) => {
    console.error('❌ Request Error:', error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    console.group('✅ API Response');
    console.log('Status:', response.status, response.statusText);
    console.log('URL:', response.config.url);
    console.log('Data:', response.data);
    console.groupEnd();
    return response;
  },
  (error) => {
    console.group('❌ API Error');
    console.log('Status:', error.response?.status, error.response?.statusText);
    console.log('URL:', error.config?.url);
    console.log('Error:', error.message);
    if (error.response?.data) {
      console.log('Error Data:', error.response.data);
    }
    console.groupEnd();
    return Promise.reject(error);
  }
);

export default api;
