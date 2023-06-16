import axios from 'axios';
import * as dotenv from 'dotenv'
import prometheusClient, {Gauge} from "prom-client";
import * as http from "http";
const regression = require('regression');

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
async function memoryOneHourTrend(url: string, start: number, end: number) {
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
async function cpuOneHourTrend(url: string, start: number, end: number) {
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
function average(pods) {
    let sum = 0;
    for (let i = 0; i < pods.values.length; i++) {
        sum += parseFloat(pods.values[i][1]);
    }
    return sum / pods.values.length;
}
function outlierAverage(pods) {
    const values = pods.values.map((value) => parseFloat(value[1]));
    const sortedValues = values.sort((a, b) => a - b);
    const length = sortedValues.length;
    const startIndex = Math.floor(length * 0.05);
    const endIndex = Math.floor(length * 0.95);
    const trimmedValues = sortedValues.slice(startIndex, endIndex);
    const sum = trimmedValues.reduce((acc, val) => acc + val, 0);
    return sum / trimmedValues.length;
}
function polynomialRegression(pods) {
    const result = regression.polynomial(pods, {order: 2});
    const indexToPredict = pods.length;
    const coefficients = result.equation;
    const equation = coefficients
        .map((coefficient, i) => `${coefficient.toFixed(6)} * x^${i}`)
        .join(' + ');
    const value = result.predict(indexToPredict)[1];
    return {
        equation: equation,
        value: value,
    };
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
        const customTime_30minAgo = currentTime - 1800;
        const customTime_120minAgo = currentTime - 7200;

        const memoryHourlyTrend = await memoryOneHourTrend(process.env.API_URL + '/api/v1/query_range', customTime_120minAgo, currentTime);
        const cpuHourlyTrend = await cpuOneHourTrend(process.env.API_URL + '/api/v1/query_range', customTime_120minAgo, currentTime);

        const memoryUsageBytesCurrent = await memoryUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const memoryResourceRequestCurrent = await memoryResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuUsageCoresCurrent = await cpuUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuResourceRequestCurrent = await cpuResourceRequests(process.env.API_URL + '/api/v1/query', currentTime);

        const memoryUsageBytesCustom = await memoryUsage(process.env.API_URL + '/api/v1/query', customTime_30minAgo);
        const memoryResourceRequestCustom = await memoryResourceRequests(process.env.API_URL + '/api/v1/query', customTime_30minAgo);
        const cpuUsageCoresCustom = await cpuUsage(process.env.API_URL + '/api/v1/query', customTime_30minAgo);
        const cpuResourceRequestCustom = await cpuResourceRequests(process.env.API_URL + '/api/v1/query', customTime_30minAgo);

        const pod = {}
        const indexedData = {};
        // Indexing the trend data in order to use in polynomial function
        for (const pod of memoryHourlyTrend.data.data.result) {
            const values = pod.values.map(([, value]) => Number(value));
            const indexedValues = values.map((value, index) => [index, value]);
            indexedData[pod.metric.pod] = indexedValues;
        }

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
        // Memory Expected Usage (Calculated with averaging)
        for (const pods of memoryHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryExpectedUsageAvg = byteToMegabyte(average(pods));
        }
        // Memory Expected Usage (Calculated with outlier averaging)
        for (const pods of memoryHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryExpectedUsageOutlierAvg = byteToMegabyte(outlierAverage(pods));
        }
        // Memory Expected Usage (Calculated with polynomial regression)
        for (const pods of memoryHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].memoryExpectedUsagePolynomialRegression =
                byteToMegabyte(polynomialRegression(indexedData[pods.metric.pod]).value);
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
        // CPU Expected Usage (Calculated with averaging)
        for (const pods of cpuHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuExpectedUsage = coreToMilicore(average(pods));
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
            memoryMetrics.labels(
                {
                    type: 'deviation_from_expected',
                    pod: podName
                })
                .set(pod[podName].memoryUsage - pod[podName].memoryExpectedUsagePolynomialRegression);
            memoryMetrics.labels(
                {
                    type: 'expected_usage_polynomial_regression',
                    pod: podName
                })
                .set(pod[podName].memoryExpectedUsagePolynomialRegression);
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
