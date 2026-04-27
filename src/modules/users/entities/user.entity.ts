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

  @Column({ unique: true, nullable: true })
  externalKey: string;

  @Column({ nullable: true })
  relationKey: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: true })
  mustChangePassword: boolean;

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

  // @JoinTable() va en el lado desde donde normalmente “administras” la relación.
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
