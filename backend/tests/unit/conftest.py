"""Pure unit tests don't need the Postgres-backed app fixtures from the
parent conftest — override the autouse DB setup with a no-op so this
subtree runs without a live database."""

import pytest


@pytest.fixture(autouse=True, scope="session")
def setup_db():
    yield
