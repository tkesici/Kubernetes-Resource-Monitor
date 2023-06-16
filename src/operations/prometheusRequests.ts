import axios from 'axios';

export async function getMemoryUsage(url: string, time: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(container_memory_working_set_bytes) by(pod)',
                time: time,
                step: '1'
            }
        }
    );
}

export async function getCpuUsage(url: string, time: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(rate(container_cpu_usage_seconds_total[120s])) by(pod)',
                time: time,
                step: '1'
            }
        }
    );
}

export async function getMemoryRequest(url: string, time: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(kube_pod_container_resource_requests{resource="memory"}) by(pod)',
                time: time,
                step: '1'
            }
        }
    );
}

export async function getCpuRequest(url: string, time: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(kube_pod_container_resource_requests{resource="cpu"}) by(pod)',
                time: time,
                step: '1'
            }
        }
    );
}

export async function getMemoryTrend(url: string, start: number, end: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(container_memory_working_set_bytes) by(pod)',
                start: start,
                end: end,
                step: '360'
            }
        }
    );
}

export async function getCpuTrend(url: string, start: number, end: number) {
    return await axios.get(url,
        {
            params: {
                query: 'sum(rate(container_cpu_usage_seconds_total[120s])) by(pod)',
                start: start,
                end: end,
                step: '360'
            }
        }
    );
}