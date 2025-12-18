import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
});

export const getHello = async () => {
  const response = await api.get('/hello');
  return response.data;
};