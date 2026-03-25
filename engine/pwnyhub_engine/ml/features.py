from typing import Dict, Any

def extract_risk_features(action: Dict[str, Any]) -> Dict[str, float]:
    """Extract numeric + boolean features from an Action for ML models"""
    params = action.get("parameters", []) if isinstance(action.get("parameters"), list) else []
    
    features = {
        "base_score": float(action.get("base_score", 0)),
        "path_depth": float(action.get("path_depth", len(action.get("path", "").split("/")) - 1)),
        "param_count": float(len(params)),
        "has_sensitive_keyword": 1.0 if action.get("has_sensitive_keyword") else 0.0,
        "entropy": float(action.get("entropy", 0.0)),
        "is_idor_candidate": 1.0 if action.get("is_idor_candidate") else 0.0,
        "status_code": float(action.get("status_code", 200)),
        "method_is_post": 1.0 if action.get("method", "").upper() == "POST" else 0.0,
        "has_query_params": 1.0 if params else 0.0,
        # add more later as you discover good signals
    }
    return features