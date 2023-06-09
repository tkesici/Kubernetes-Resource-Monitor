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
    labelNames: ['type','pod'],
});
const cpuMetrics = new Gauge({
    name: 'cpu_request_usage_diff',
    help: 'Gauge for monitoring CPU usage and resource requests.',
    labelNames: ['type','pod'],
});

async function main() {
    try {
        const currentTime = new Date().getTime() / 1000;

        const memoryUsageBytes = await memoryUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const memoryResourceRequest = await memoryResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuUsageCores = await cpuUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuResourceRequest = await cpuResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);

        const pod = {}

        for (const pods of memoryResourceRequest.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryRequest = byteToMegabyte(pods.value[1]);
        }
        for (const pods of memoryUsageBytes.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryUsage = byteToMegabyte(pods.value[1]);
        }
        for (const pods of cpuResourceRequest.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuRequest = coreToMilicore(pods.value[1]);
        }
        for (const pods of cpuUsageCores.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuUsage = coreToMilicore(pods.value[1]);
        }

        for (const podName of Object.keys(pod)) {
            memoryMetrics.labels(
                {
                    type: 'request_diff',
                    pod: podName
                })
                .set(pod[podName].memoryUsage - (pod[podName].memoryRequest ?? 0));
            if(pod[podName].hasOwnProperty('memoryRequest')){
                memoryMetrics.labels(
                    {
                        type: 'request_percentage',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsage / pod[podName].memoryRequest) * 100)
            } else {
                memoryMetrics.labels(
                    {
                        type: 'request_percentage',
                        pod: podName
                    })
                    .set(999999)
            }
            cpuMetrics.labels(
                {
                    type: 'request_diff',
                    pod: podName
                })
                .set(pod[podName].cpuUsage - (pod[podName].cpuRequest ?? 0));
            if(pod[podName].hasOwnProperty('cpuRequest')) {
                cpuMetrics.labels(
                    {
                        type: 'request_percentage',
                        pod: podName
                    })
                    .set((pod[podName].cpuUsage / pod[podName].cpuRequest) * 100)
            }
            else {
                cpuMetrics.labels(
                    {
                        type: 'request_percentage',
                        pod: podName
                    })
                    .set(999999)
            }
        }

    } catch (error) {
        // Handle the exception
        console.error('An error occurred:', error);
    }
}
setInterval(main, 3000);



