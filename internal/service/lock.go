package service

import "context"

// operationLock serializes work without making cancellation wait for another
// repository operation (or an OAuth request) to finish.
type operationLock chan struct{}

func newOperationLock() operationLock { return make(operationLock, 1) }

func (l operationLock) Lock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case l <- struct{}{}:
		if err := ctx.Err(); err != nil {
			l.Unlock()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (l operationLock) Unlock() { <-l }
