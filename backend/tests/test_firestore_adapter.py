from collections.abc import Iterable, Mapping
from typing import Any

import pytest

from libs.repositories.firestore_adapter import FirestoreDocumentStore
from libs.repositories.store import DocumentAlreadyExistsError, DocumentQueryFilter


class FakeSnapshot:
    def __init__(self, data: dict[str, object] | None) -> None:
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict[str, object] | None:
        if self._data is None:
            return None
        return dict(self._data)


class FakeDocumentReference:
    def __init__(self, client: "FakeFirestoreClient", path: str) -> None:
        self._client = client
        self._path = path

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self._client.documents.get(self._path))

    def set(self, document_data: Mapping[str, object]) -> None:
        self._client.documents[self._path] = dict(document_data)


class FakeCollectionReference:
    def __init__(self, client: "FakeFirestoreClient", collection_path: str) -> None:
        self._client = client
        self._collection_path = collection_path

    def stream(self) -> Iterable[FakeSnapshot]:
        prefix = f"{self._collection_path}/"
        for path in sorted(self._client.documents):
            if path.startswith(prefix) and "/" not in path.removeprefix(prefix):
                yield FakeSnapshot(self._client.documents[path])

    def where(
        self,
        field_path: str | None = None,
        op_string: str | None = None,
        value: object = None,
        *,
        filter: object = None,
    ) -> "FakeQuery":
        return FakeQuery(self, [_filter_tuple(field_path, op_string, value, filter)], None)

    def limit(self, count: int) -> "FakeQuery":
        return FakeQuery(self, [], count)


class FakeQuery:
    def __init__(
        self,
        collection: FakeCollectionReference,
        filters: list[tuple[str, str, object]],
        limit_count: int | None,
    ) -> None:
        self._collection = collection
        self._filters = filters
        self._limit_count = limit_count

    def where(
        self,
        field_path: str | None = None,
        op_string: str | None = None,
        value: object = None,
        *,
        filter: object = None,
    ) -> "FakeQuery":
        return FakeQuery(
            self._collection,
            [*self._filters, _filter_tuple(field_path, op_string, value, filter)],
            self._limit_count,
        )

    def limit(self, count: int) -> "FakeQuery":
        return FakeQuery(self._collection, self._filters, count)

    def stream(self) -> Iterable[FakeSnapshot]:
        returned = 0
        for snapshot in self._collection.stream():
            document = snapshot.to_dict()
            if document is None or not _matches(document, self._filters):
                continue
            yield snapshot
            returned += 1
            if self._limit_count is not None and returned >= self._limit_count:
                return


class FakeFirestoreClient:
    def __init__(self) -> None:
        self.documents: dict[str, dict[str, object]] = {}

    def document(self, document_path: str) -> FakeDocumentReference:
        return FakeDocumentReference(self, document_path)

    def collection(self, collection_path: str) -> FakeCollectionReference:
        return FakeCollectionReference(self, collection_path)


def test_firestore_adapter_sets_gets_lists_and_respects_create_only() -> None:
    client = FakeFirestoreClient()
    store = FirestoreDocumentStore(client)

    store.set_document("promotions/promotion-001", {"promotionId": "promotion-001"})
    store.set_document("promotions/promotion-002", {"promotionId": "promotion-002"})

    assert store.get_document("promotions/promotion-001") == {"promotionId": "promotion-001"}
    assert store.get_document("promotions/missing") is None
    assert store.list_documents("promotions") == [
        {"promotionId": "promotion-001"},
        {"promotionId": "promotion-002"},
    ]

    with pytest.raises(DocumentAlreadyExistsError):
        store.set_document(
            "promotions/promotion-001",
            {"promotionId": "promotion-001"},
            exists_ok=False,
        )


def test_firestore_adapter_queries_with_filters_and_limit() -> None:
    client = FakeFirestoreClient()
    store = FirestoreDocumentStore(client)
    store.set_document(
        "creatorDiscoveryProfiles/creator-001",
        {
            "creatorId": "creator-001",
            "agentStatus": "PUBLISHED",
            "formatKeys": ["reel", "story"],
        },
    )
    store.set_document(
        "creatorDiscoveryProfiles/creator-002",
        {
            "creatorId": "creator-002",
            "agentStatus": "DRAFT",
            "formatKeys": ["reel"],
        },
    )

    results = store.query_documents(
        "creatorDiscoveryProfiles",
        [
            DocumentQueryFilter("agentStatus", "==", "PUBLISHED"),
            DocumentQueryFilter("formatKeys", "array_contains", "reel"),
        ],
        limit=1,
    )

    assert results == [
        {
            "creatorId": "creator-001",
            "agentStatus": "PUBLISHED",
            "formatKeys": ["reel", "story"],
        }
    ]


def _filter_tuple(
    field_path: str | None, op_string: str | None, value: object, field_filter: Any
) -> tuple[str, str, object]:
    # Mirrors the real SDK: either positional (deprecated) or `filter=FieldFilter(...)`.
    if field_filter is not None:
        assert field_path is None and op_string is None, "mixed positional and filter="
        return (str(field_filter.field_path), str(field_filter.op_string), field_filter.value)
    assert field_path is not None and op_string is not None
    return (field_path, op_string, value)


def _matches(document: Mapping[str, object], filters: list[tuple[str, str, object]]) -> bool:
    for field_path, op_string, expected in filters:
        value = document.get(field_path)
        if op_string == "==" and value != expected:
            return False
        if op_string == "array_contains" and (not isinstance(value, list) or expected not in value):
            return False
    return True
