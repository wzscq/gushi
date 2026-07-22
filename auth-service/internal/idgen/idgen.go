package idgen

import (
	"fmt"
	"sync"
	"time"
)

// Generator produces IDs: yyyymmddhhmmss + 3-digit sequence within the same second.
// Example: 20260715195700000, 20260715195700001, ...
//
// Monotonic: if wall clock jumps backward (e.g. NTP), lastSec is kept so IDs
// never decrease and cannot collide with earlier IDs from this process.
type Generator struct {
	mu      sync.Mutex
	lastSec string
	seq     int
	now     func() time.Time
}

func New() *Generator {
	return &Generator{now: time.Now}
}

// Next returns the next unique ID. If more than 1000 IDs are requested in the
// same logical second, it waits until the wall clock advances past lastSec.
func (g *Generator) Next() string {
	for {
		g.mu.Lock()
		sec := g.now().Format("20060102150405")
		// Only advance on a strictly later second; rewind keeps lastSec.
		if sec > g.lastSec {
			g.lastSec = sec
			g.seq = 0
		}
		if g.seq < 1000 {
			id := fmt.Sprintf("%s%03d", g.lastSec, g.seq)
			g.seq++
			g.mu.Unlock()
			return id
		}
		g.mu.Unlock()
		time.Sleep(2 * time.Millisecond)
	}
}
