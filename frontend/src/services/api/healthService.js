import { axiosClient } from './axiosClient';

export async function fetchHealth() {
  const { data } = await axiosClient.get('/health');
  return data;
}
