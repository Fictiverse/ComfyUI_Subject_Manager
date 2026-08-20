from .subject_manager_node import SubjectManagerNode, SubjectUnpackNode
from . import server_routes  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "SubjectManagerNode": SubjectManagerNode,
    "SubjectUnpackNode": SubjectUnpackNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SubjectManagerNode": "🗂️ Subject Manager",
    "SubjectUnpackNode": "📦 Subject Unpack",
}

WEB_DIRECTORY = "web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]