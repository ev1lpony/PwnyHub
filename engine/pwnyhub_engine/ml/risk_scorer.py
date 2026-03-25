from typing import Dict, Any, Optional
import joblib
from pathlib import Path

from .features import extract_risk_features

class MLRiskScorer:
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = Path(model_path) if model_path else None
        self.model = None
        self.use_ml = False

        if self.model_path and self.model_path.exists():
            try:
                self.model = joblib.load(self.model_path)
                self.use_ml = True
                print(f"[PwnyHub ML] Loaded risk model: {self.model_path.name}")
            except Exception as e:
                print(f"[PwnyHub ML] Could not load model ({e}). Falling back to heuristics.")

    def score(self, action: Dict[str, Any]) -> Dict[str, Any]:
        # Lazy import to avoid circular import
        from ..risk import calculate_risk

        # Always start with pure heuristics
        result = calculate_risk(action)

        if not self.use_ml or self.model is None:
            return result

        try:
            features = extract_risk_features(action)
            ml_adjustment = self.model.predict([list(features.values())])[0]
            
            new_score = result["risk_score"] + ml_adjustment
            result["risk_score"] = max(0, min(100, round(new_score)))
            result["ml_confidence"] = 0.80
            if "ml-boosted" not in result.get("risk_tags", []):
                result["risk_tags"] = result.get("risk_tags", []) + ["ml-boosted"]
                
        except Exception as e:
            print(f"[PwnyHub ML] Prediction failed: {e}")

        return result