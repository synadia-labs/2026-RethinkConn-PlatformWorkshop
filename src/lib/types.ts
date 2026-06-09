export interface Point {
  x: number
  y: number
}

export interface DrawMessage {
  type: 'draw'
  id: string
  from: Point
  to: Point
  thickness: number
  color: string
}

export interface ClearMessage {
  type: 'clear'
  id: string
}

export interface ShapeMessage {
  type: 'shape'
  id: string
  shape: 'line' | 'rect' | 'ellipse'
  origin: Point
  endpoint: Point
  thickness: number
  color: string
}

export type Tool = 'draw' | 'line' | 'rect' | 'ellipse'

export type Message = DrawMessage | ClearMessage | ShapeMessage
