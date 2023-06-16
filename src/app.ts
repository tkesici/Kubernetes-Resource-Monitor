import * as dotenv from 'dotenv'
import prometheusClient, {Gauge} from "prom-client";
import * as http from "http";
import { average, outlierAverage, polynomialRegression } from './helpers/estimation';
import { byteToMegabyte, coreToMilicore} from "./operations/conversion";
import * as prometheusRequest from './operations/prometheusRequests';

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

const memoryMetrics = new Gauge({
    name: 'memory_metrics',
    help: 'Gauge for monitoring memory usage and resource requests.',
    labelNames: ['type', 'pod'],
});

const cpuMetrics = new Gauge({
    name: 'cpu_metrics',
    help: 'Gauge for monitoring CPU usage and resource requests.',
    labelNames: ['type', 'pod'],
});

async function main() {
    try {
        const currentTime = new Date().getTime() / 1000;
        const thirtyMinAgo = currentTime - 1800;
        const oneDayAgo = currentTime - 86400;

        const memoryHourlyTrend = await prometheusRequest.getMemoryTrend(process.env.API_URL + '/api/v1/query_range', oneDayAgo, currentTime);
        const cpuHourlyTrend = await prometheusRequest.getCpuTrend(process.env.API_URL + '/api/v1/query_range', oneDayAgo, currentTime);

        const memoryUsageBytesCurrent = await prometheusRequest.getMemoryUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const memoryResourceRequestCurrent = await prometheusRequest.getMemoryRequest(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuUsageCoresCurrent = await prometheusRequest.getCpuUsage(process.env.API_URL + '/api/v1/query', currentTime);
        const cpuResourceRequestCurrent = await prometheusRequest.getCpuRequest(process.env.API_URL + '/api/v1/query', currentTime);

        const memoryUsageBytesCustom = await prometheusRequest.getMemoryUsage(process.env.API_URL + '/api/v1/query', thirtyMinAgo);
        const memoryResourceRequestCustom = await prometheusRequest.getMemoryRequest(process.env.API_URL + '/api/v1/query', thirtyMinAgo);
        const cpuUsageCoresCustom = await prometheusRequest.getCpuUsage(process.env.API_URL + '/api/v1/query', thirtyMinAgo);
        const cpuResourceRequestCustom = await prometheusRequest.getCpuRequest(process.env.API_URL + '/api/v1/query', thirtyMinAgo);

        const pod = {}
        const indexedMemoryData = {};
        const indexedCpuData = {};
        // Indexing the trend data of the memory and CPU in order to use in polynomial function
        for (const pod of memoryHourlyTrend.data.data.result) {
            const values = pod.values.map(([, value]) => Number(value));
            const indexedValues = values.map((value, index) => [index, value]);
            indexedMemoryData[pod.metric.pod] = indexedValues;
        }
        for (const pod of cpuHourlyTrend.data.data.result) {
            const values = pod.values.map(([, value]) => Number(value));
            const indexedValues = values.map((value, index) => [index, value]);
            indexedCpuData[pod.metric.pod] = indexedValues;
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
                byteToMegabyte(polynomialRegression(indexedMemoryData[pods.metric.pod]).value);
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
        // CPU Expected Usage (Calculated with averaging)
        for (const pods of cpuHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuExpectedUsageAvg = coreToMilicore(average(pods));
        }
        // CPU Expected Usage (Calculated with outlier averaging)
        for (const pods of cpuHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuExpectedUsageOutlierAvg = coreToMilicore(outlierAverage(pods));
        }
        // CPU Expected Usage (Calculated with polynomial regression)
        for (const pods of cpuHourlyTrend.data.data.result) {
            pod[pods.metric.pod] ??= {};
            pod[pods.metric.pod].cpuExpectedUsagePolynomialRegression =
                coreToMilicore(polynomialRegression(indexedCpuData[pods.metric.pod]).value);
        }

        for (const podName of Object.keys(pod)) {
            // Memory Gauge
            if (pod[podName].memoryUsage !== undefined) {
                memoryMetrics.labels({
                    type: 'usage',
                    pod: podName
                }).set(pod[podName].memoryUsage);
                memoryMetrics.labels(
                    {
                        type: 'difference_between_usage_and_request',
                        pod: podName
                    })
                    .set(pod[podName].memoryUsage - (pod[podName].memoryRequest ?? 0));
                memoryMetrics.labels(
                    {
                        type: 'historic_difference_between_usage_and_request(30min)',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsage - (pod[podName].memoryRequest ?? 0)) -
                        (pod[podName].memoryUsageHistoric ?? 0) - (pod[podName].memoryRequestHistoric ?? 0));
                memoryMetrics.labels(
                    {
                        type: 'predictive_value(polynomial_regression)',
                        pod: podName
                    })
                    .set(pod[podName].memoryExpectedUsagePolynomialRegression);
                memoryMetrics.labels(
                    {
                        type: 'predictive_value(average)',
                        pod: podName
                    })
                    .set(pod[podName].memoryExpectedUsageAvg);
                memoryMetrics.labels(
                    {
                        type: 'predictive_value(outlier_avg)',
                        pod: podName
                    })
                    .set(pod[podName].memoryExpectedUsageOutlierAvg);
                memoryMetrics.labels(
                    {
                        type: 'deviation_from_prediction',
                        pod: podName
                    })
                    .set(pod[podName].memoryUsage - pod[podName].memoryExpectedUsagePolynomialRegression);
            }
            if (pod[podName].hasOwnProperty('memoryRequest')) {
                memoryMetrics.labels(
                    {
                        type: 'percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsage / pod[podName].memoryRequest) * 100)
                memoryMetrics.labels(
                    {
                        type: 'historic_percentage_of_usage_and_request(30min)',
                        pod: podName
                    })
                    .set((pod[podName].memoryUsageHistoric / pod[podName].memoryRequestHistoric) * 100)
            } else {
                memoryMetrics.labels(
                    {
                        type: 'percentage_of_usage_and_request',
                        pod: podName
                    })
                    .set(999999);
            }
            // CPU Gauge
            if (pod[podName].cpuUsage !== undefined) {
                cpuMetrics.labels(
                    {
                        type: 'difference_between_usage_and_request',
                        pod: podName
                    })
                    .set(pod[podName].cpuUsage - (pod[podName].cpuRequest ?? 0));
                cpuMetrics.labels(
                    {
                        type: 'historic_difference_between_usage_and_request',
                        pod: podName
                    })
                    .set((pod[podName].cpuUsage - (pod[podName].cpuRequest ?? 0)) -
                        (pod[podName].cpuUsageHistoric ?? 0) - (pod[podName].cpuRequestHistoric ?? 0));
                cpuMetrics.labels(
                    {
                        type: 'predictive_value(polynomial_regression)',
                        pod: podName
                    })
                    .set(pod[podName].cpuExpectedUsagePolynomialRegression);
                cpuMetrics.labels(
                    {
                        type: 'predictive_value(average)',
                        pod: podName
                    })
                    .set(pod[podName].cpuExpectedUsageAvg);
                cpuMetrics.labels(
                    {
                        type: 'predictive_value(outlier_avg)',
                        pod: podName
                    })
                    .set(pod[podName].cpuExpectedUsageOutlierAvg);
                cpuMetrics.labels(
                    {
                        type: 'deviation_from_prediction',
                        pod: podName
                    })
                    .set(pod[podName].cpuUsage - pod[podName].cpuExpectedUsagePolynomialRegression);

            }

            if (pod[podName].hasOwnProperty('cpuRequest')) {
                cpuMetrics.labels(
                    {
                        type: 'percentage_of_usage_and_request',
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
                        type: 'percentage_of_usage_and_request',
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
