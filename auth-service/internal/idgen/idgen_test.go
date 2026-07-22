package idgen

import (
	"testing"
	"time"
)

func TestNext_SameSecondSequence(t *testing.T) {
	fixed := time.Date(2026, 7, 15, 19, 57, 0, 0, time.Local)
	g := &Generator{
		now: func() time.Time { return fixed },
	}

	a := g.Next()
	b := g.Next()
	c := g.Next()

	if a != "20260715195700000" {
		t.Fatalf("got %s want 20260715195700000", a)
	}
	if b != "20260715195700001" {
		t.Fatalf("got %s want 20260715195700001", b)
	}
	if c != "20260715195700002" {
		t.Fatalf("got %s want 20260715195700002", c)
	}
}

func TestNext_ResetsOnNewSecond(t *testing.T) {
	sec := 0
	base := time.Date(2026, 7, 15, 19, 57, 0, 0, time.Local)
	g := &Generator{
		now: func() time.Time {
			return base.Add(time.Duration(sec) * time.Second)
		},
	}

	a := g.Next()
	sec = 1
	b := g.Next()

	if a != "20260715195700000" {
		t.Fatalf("got %s want 20260715195700000", a)
	}
	if b != "20260715195701000" {
		t.Fatalf("got %s want 20260715195701000", b)
	}
}

func TestNext_ClockRewindKeepsLastSec(t *testing.T) {
	offset := 0
	base := time.Date(2026, 7, 15, 19, 57, 5, 0, time.Local)
	g := &Generator{
		now: func() time.Time {
			return base.Add(time.Duration(offset) * time.Second)
		},
	}

	a := g.Next() // 19:57:05 → ...05705000
	offset = -3   // clock jumps back to 19:57:02
	b := g.Next()
	c := g.Next()

	if a != "20260715195705000" {
		t.Fatalf("got %s want 20260715195705000", a)
	}
	// Still on lastSec 19:57:05, sequence continues
	if b != "20260715195705001" {
		t.Fatalf("got %s want 20260715195705001", b)
	}
	if c != "20260715195705002" {
		t.Fatalf("got %s want 20260715195705002", c)
	}
}
