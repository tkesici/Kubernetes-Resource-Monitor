import axios from 'axios';
import * as dotenv from 'dotenv'
import prometheusClient, {Gauge} from "prom-client";
import * as http from "http";

dotenv.config();
prometheusClient.collectDefaultMetrics();

const metricsServer = http.createServer((req, res) => {
    prometheusClient.register.metrics().then(metricsStr => {
        res.writeHead(200);
        res.write(Buffer.from(metricsStr));
        res.end();
    });
});
metricsServer.listen(3000);

async function memoryUsage(url: string, time: number) {
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

async function cpuUsage(url: string, time: number) {
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

async function memoryResourceRequests(url: string, time: number) {
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

async function cpuResourceRequests(url: string, time: number) {
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

function byteToMegabyte(number: number) {
    return Number(number / 1_048_576);
}

function coreToMilicore(number: number) {
    return Number(number * 1_000);
}

const memoryMetrics = new Gauge({
    name: 'memory_request_usage_diff',
    help: 'Gauge for monitoring memory usage and resource requests.',
    labelNames: ['type', 'pod'],
});
const cpuMetrics = new Gauge({
    name: 'cpu_request_usage_diff',
    help: 'Gauge for monitoring CPU usage and resource requests.',
    labelNames: ['type', 'pod'],
});

async function main() {
    try {
        const currentTime = new Date().getTime() / 1000;
        const customTime = currentTime - 1800;

        const memoryUsageBytesCurrent = await memoryUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const memoryResourceRequestCurrent = await memoryResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuUsageCoresCurrent = await cpuUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuResourceRequestCurrent = await cpuResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);

        const memoryUsageBytesCustom = await memoryUsage(process.env.API_URL + '/api/v1/query', customTime);
        const memoryResourceRequestCustom = await memoryResourceRequests(process.env.API_URL + '/api/v1/query', customTime);
        const cpuUsageCoresCustom = await cpuUsage(process.env.API_URL + '/api/v1/query', customTime);
        const cpuResourceRequestCustom = await cpuResourceRequests(process.env.API_URL + '/api/v1/query', customTime);

        const pod = {}

        // Memory Usage Metrics
        for (const pods of memoryUsageBytesCurrent.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryUsage = byteToMegabyte(pods.value[1]);
        }
        // Memory Usage Metrics Historic
        for (const pods of memoryUsageBytesCustom.data.data.result) {
            pod[pods.metric.pod].memoryUsageHistoric = byteToMegabyte(pods.value[1]);
        }
        // Memory Resource Request Metrics
        for (const pods of memoryResourceRequestCurrent.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryRequest = byteToMegabyte(pods.value[1]);
        }
        // Memory Resource Request Metrics Historic
        for (const pods of memoryResourceRequestCustom.data.data.result) {
            pod[pods.metric.pod].memoryRequestHistoric = byteToMegabyte(pods.value[1]);
        }

        // CPU Usage Metrics
        for (const pods of cpuUsageCoresCurrent.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuUsage = coreToMilicore(pods.value[1]);
        }
        // CPU Usage Metrics Historic
        for (const pods of cpuUsageCoresCustom.data.data.result) {
            pod[pods.metric.pod].cpuUsageHistoric = coreToMilicore(pods.value[1]);
        }
        // CPU Resource Request Metrics
        for (const pods of cpuResourceRequestCurrent.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuRequest = coreToMilicore(pods.value[1]);
        }
        // CPU Resource Request Metrics Historic
        for (const pods of cpuResourceRequestCustom.data.data.result) {
            pod[pods.metric.pod].cpuRequestHistoric = coreToMilicore(pods.value[1]);
        }

        for (const podName of Object.keys(pod)) {
            // Memory Gauge
            memoryMetrics.labels(
                {
                    type: 'current_diff_between_usage_and_request',
                    pod: podName
                })
                .set(pod[podName].memoryUsage - (pod[podName].memoryRequest ?? 0));
            memoryMetrics.labels(
                {
                    type: 'historic_diff_between_usage_and_request',
                    pod: podName
                })
                .set((pod[podName].memoryUsage - (pod[podName].memoryRequest ?? 0)) -
                    (pod[podName].memoryUsageHistoric ?? 0) - (pod[podName].memoryRequestHistoric ?? 0));
            if (pod[podName].hasOwnProperty('memoryRequest')) {
                memoryMetrics.labels(
                    {
                        type: 'current_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsage / pod[podName].memoryRequest) * 100)
                memoryMetrics.labels(
                    {
                        type: 'historic_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsageHistoric / pod[podName].memoryRequestHistoric) * 100)
            } else {
                memoryMetrics.labels(
                    {
                        type: 'current_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set(999999);
            }
            // CPU Gauge
            cpuMetrics.labels(
                {
                    type: 'current_diff_between_usage_and_request',
                    pod: podName
                })
                .set(pod[podName].cpuUsage - (pod[podName].cpuRequest ?? 0));
            cpuMetrics.labels(
                {
                    type: 'historic_diff_between_usage_and_request',
                    pod: podName
                })
                .set((pod[podName].cpuUsage - (pod[podName].cpuRequest ?? 0)) -
                    (pod[podName].cpuUsageHistoric ?? 0) - (pod[podName].cpuRequestHistoric ?? 0));
            if (pod[podName].hasOwnProperty('cpuRequest')) {
                cpuMetrics.labels(
                    {
                        type: 'current_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].cpuUsage / pod[podName].cpuRequest) * 100)
                cpuMetrics.labels(
                    {
                        type: 'historic_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].cpuUsageHistoric / pod[podName].cpuRequestHistoric) * 100)
            } else {
                cpuMetrics.labels(
                    {
                        type: 'current_percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set(999999);
            }
        }

    } catch (error) {
        console.error('An error occurred:', error);
    }
}

setInterval(main, 3000);



