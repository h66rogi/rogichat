import { Injectable } from '@nestjs/common';

/** Process-local drain signal, never an authorization or durable delivery state. */
@Injectable()
export class LifecycleState { draining = false; }
