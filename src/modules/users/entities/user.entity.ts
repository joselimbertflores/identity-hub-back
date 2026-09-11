import { Application } from 'src/modules/access/entities';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  UpdateDateColumn,
  CreateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  login: string;

  @Column({ select: false })
  password: string;

  @Column()
  fullName: string;

  @Column({ unique: true })
  externalKey: string;

  @Column('varchar', { nullable: true })
  relationKey: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: true })
  mustChangePassword: boolean;

  // Invalidates refresh tokens and SSO sessions issued before the latest credential change.
  @Column({ type: 'integer', default: 0, select: false })
  credentialVersion: number;

  @Column({
    type: 'enum',
    enum: UserRole,
    array: true,
    default: [UserRole.USER],
  })
  roles: UserRole[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToMany(() => Application, (application) => application.users)
  @JoinTable({
    name: 'user_applications',
    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'application_id',
      referencedColumnName: 'id',
    },
  })
  applications: Application[];
}
