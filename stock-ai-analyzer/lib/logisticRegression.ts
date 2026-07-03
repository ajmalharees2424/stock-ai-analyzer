// A small, dependency-free logistic regression implementation.
//
// Why hand-rolled instead of a library: the feature count here is tiny
// (~8 features), training happens fresh per-request on a few thousand rows,
// and pulling in a full ML framework (e.g. TensorFlow.js) would add a lot of
// cold-start weight to a Vercel serverless function for no real benefit.
// Plain batch gradient descent converges in milliseconds at this scale.

export interface LogisticRegressionModel {
  weights: number[];
  bias: number;
  featureMeans: number[];
  featureStds: number[];
}

export interface TrainOptions {
  learningRate?: number;
  epochs?: number;
  l2?: number;
}

function sigmoid(z: number): number {
  // Clamp to avoid Math.exp overflow on extreme inputs.
  const clamped = Math.max(-35, Math.min(35, z));
  return 1 / (1 + Math.exp(-clamped));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function computeStats(X: number[][]): { means: number[]; stds: number[] } {
  const n = X.length;
  const d = X[0].length;
  const means = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j];
  for (let j = 0; j < d; j++) means[j] /= n;

  const stds = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < d; j++) stds[j] = Math.sqrt(stds[j] / n) || 1; // guard divide-by-zero

  return { means, stds };
}

function standardizeWith(X: number[][], means: number[], stds: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
}

/**
 * Trains a logistic regression classifier via batch gradient descent with
 * L2 regularization. Feature standardization statistics are computed from
 * the training set ONLY (never the test set) to avoid leaking information
 * across the train/test boundary.
 */
export function trainLogisticRegression(
  X: number[][],
  y: number[],
  opts: TrainOptions = {}
): LogisticRegressionModel {
  if (X.length === 0 || X.length !== y.length) {
    throw new Error("trainLogisticRegression: X and y must be non-empty and same length");
  }
  const learningRate = opts.learningRate ?? 0.15;
  const epochs = opts.epochs ?? 800;
  const l2 = opts.l2 ?? 0.02;

  const { means, stds } = computeStats(X);
  const Xs = standardizeWith(X, means, stds);
  const n = Xs.length;
  const d = Xs[0].length;

  const weights = new Array(d).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const pred = sigmoid(dot(Xs[i], weights) + bias);
      const error = pred - y[i];
      for (let j = 0; j < d; j++) gradW[j] += error * Xs[i][j];
      gradB += error;
    }
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= learningRate * (gradB / n);
  }

  return { weights, bias, featureMeans: means, featureStds: stds };
}

export function predictProbability(model: LogisticRegressionModel, x: number[]): number {
  const xs = x.map((v, j) => (v - model.featureMeans[j]) / model.featureStds[j]);
  return sigmoid(dot(xs, model.weights) + model.bias);
}

export function evaluateAccuracy(
  model: LogisticRegressionModel,
  X: number[][],
  y: number[],
  threshold = 0.5
): number {
  if (X.length === 0) return NaN;
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    const p = predictProbability(model, X[i]);
    const predicted = p >= threshold ? 1 : 0;
    if (predicted === y[i]) correct++;
  }
  return correct / X.length;
}

/** Accuracy of always predicting whichever class is more common in `y`. Useful as a sanity baseline. */
export function majorityBaselineAccuracy(y: number[]): number {
  if (y.length === 0) return NaN;
  const ones = y.filter((v) => v === 1).length;
  const majorityCount = Math.max(ones, y.length - ones);
  return majorityCount / y.length;
}
