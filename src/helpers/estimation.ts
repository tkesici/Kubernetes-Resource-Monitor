const regression = require('regression');
export function average(pods) {
    let sum = 0;
    let podCount = pods.values.length;
    for (let i = 0; i < pods.values.length; i++) {
        if (pods.values[i][1] === undefined) {
            podCount--;
        } else {
            sum += parseFloat(pods.values[i][1]);
        }

    }
    return sum / podCount;
}
export function outlierAverage(pods) {
    const values = pods.values.map((value) => parseFloat(value[1]));
    const sortedValues = values.sort((a, b) => a - b);
    const length = sortedValues.length;
    const startIndex = Math.floor(length * 0.05);
    const endIndex = Math.floor(length * 0.95);
    const trimmedValues = sortedValues.slice(startIndex, endIndex);
    const sum = trimmedValues.reduce((acc, val) => acc + val, 0);
    return sum / trimmedValues.length;
}
export function polynomialRegression(pods) {
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