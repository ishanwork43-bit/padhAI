# Overfitting and regularization
Overfitting occurs when a model learns training-specific patterns or noise and
performs poorly on unseen data. A common symptom is low training error but much
higher validation error. Regularization discourages overly complex solutions;
L2 regularization penalizes large weights. Early stopping stops training when
validation performance stops improving. More representative training data can also
help. These remedies address generalization, but do not make an experiment valid
if information from evaluation examples leaked into training.
