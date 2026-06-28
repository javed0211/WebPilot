"""Command-line entry point for the WebPilot Browser Use adapter."""

import asyncio

from .runner import main

asyncio.run(main())
