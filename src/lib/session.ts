/**
 * How long a session is.
 *
 * One hour, and every screen that talks about time is measured against it: the
 * slot grid steps by it, the booking's end is derived from it, and the parking
 * warning compares a street limit to it.
 *
 * Here rather than beside any one of them because it was already written twice
 * — once in `booking-service` and once in `mock-repository` — and two copies of
 * a number is how the real one and the demo one quietly stop agreeing.
 */
export const SESSION_MINUTES = 60;

export const SESSION_MS = SESSION_MINUTES * 60 * 1000;
