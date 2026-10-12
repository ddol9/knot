"""MCP (Model Context Protocol) - Agent와 Data Engine 연동

MCP는 Anthropic이 제안한 표준으로, Agent가 외부 데이터 소스에
안전하게 접근하는 프로토콜입니다.

주요 컴포넌트:
- MCP Server: 데이터 소스를 MCP 프로토콜로 노출
- MCP Client: Agent에서 MCP 서버에 접근
- Semantic Layer: 비즈니스 메트릭 정의
"""

from libs.mcp.firestore_server import FirestoreMCPServer
from libs.mcp.instagram_server import InstagramMCPServer
from libs.mcp.semantic_layer import SemanticLayer

__all__ = [
    "FirestoreMCPServer",
    "InstagramMCPServer",
    "SemanticLayer",
]
