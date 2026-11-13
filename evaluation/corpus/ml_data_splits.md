# Training, validation, test data, and leakage
Training data is used to fit model parameters. Validation data guides model choices
and hyperparameters. Test data is reserved for final evaluation and should not be
used repeatedly to choose models. Data leakage occurs when information unavailable
at prediction time enters training. For example, fitting a preprocessing scaler on
the entire dataset before splitting leaks evaluation information. Fit preprocessing
on training data only, then transform validation and test data with the same fitted
parameters. A clean held-out evaluation is needed to measure generalization.
